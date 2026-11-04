import { RealDebridClient, AllDebridClient, DebridAuthError } from "@kunai/providers/debrid";
import { getKunaiPaths } from "@kunai/storage";

export type ProviderCategory = "debrid" | "anime" | "movie/series" | "platform";

export type ProviderStatusLevel =
  | "ONLINE"
  | "CLOUDFLARE"
  | "DEGRADED"
  | "OFFLINE"
  | "UNCONFIGURED"
  | "AUTH_ERROR";

export interface ProviderStatusEntry {
  readonly id: string;
  readonly name: string;
  readonly category: ProviderCategory;
  readonly configured: boolean;
  readonly status: ProviderStatusLevel;
  readonly latencyMs: number | null;
  readonly notes: string;
}

export interface ProviderStatusReport {
  readonly timestamp: string;
  readonly total: number;
  readonly online: number;
  readonly entries: readonly ProviderStatusEntry[];
}

export type ProviderStatusFetch = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface RunProviderStatusOptions {
  readonly json?: boolean;
  readonly timeoutMs?: number;
  readonly fetchFn?: ProviderStatusFetch;
  readonly getEnv?: (key: string) => string | undefined;
  readonly configPath?: string;
  readonly probeYouTube?: () => Promise<ProviderStatusEntry>;
  readonly isTty?: boolean;
  readonly noColor?: boolean;
}

const DEFAULT_TIMEOUT_MS = 4000;

const KNOWN_HTTP_PROVIDERS: readonly {
  readonly id: string;
  readonly name: string;
  readonly category: ProviderCategory;
  readonly url: string;
  readonly headers?: Record<string, string>;
}[] = [
  {
    id: "hianime",
    name: "HiAnime",
    category: "anime",
    url: "https://hianime.at/",
    headers: { Referer: "https://hianime.at/" },
  },
  { id: "miruro", name: "Miruro", category: "anime", url: "https://www.miruro.cx" },
  {
    id: "invidious",
    name: "Invidious",
    category: "platform",
    url: "https://api.invidious.io/instances.json?sort_by=type,health,api",
  },
  {
    id: "allmanga",
    name: "AllManga",
    category: "anime",
    url: "https://mkissa.to",
    headers: { Origin: "https://mkissa.to" },
  },
  { id: "animegg", name: "AnimeGG", category: "anime", url: "https://animegg.org" },
  { id: "kickassanime", name: "KickAssAnime", category: "anime", url: "https://kaa.lt" },
  { id: "vidrock", name: "VidRock", category: "movie/series", url: "https://vidrock.net" },
  { id: "vidlink", name: "VidLink", category: "movie/series", url: "https://vidlink.pro" },
  { id: "videasy", name: "Videasy", category: "movie/series", url: "https://api.videasy.to" },
  {
    id: "rivestream",
    name: "Rivestream",
    category: "movie/series",
    url: "https://www.rivestream.app/",
  },
  {
    id: "movy",
    name: "Movy",
    category: "movie/series",
    url: "https://api.wecollege.net",
    headers: { Referer: "https://www.movy.sx/", Origin: "https://www.movy.sx" },
  },
];

/**
 * Probes a direct HTTP web provider domain with a single bounded timeout budget.
 */
async function probeHttpProvider(
  provider: (typeof KNOWN_HTTP_PROVIDERS)[number],
  fetchFn: ProviderStatusFetch,
  timeoutMs: number,
): Promise<ProviderStatusEntry> {
  const start = performance.now();
  const deadline = start + timeoutMs;
  const getRemainingSignal = () => {
    const remaining = Math.max(100, Math.round(deadline - performance.now()));
    return AbortSignal.timeout(remaining);
  };

  try {
    const baseHeaders = {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      ...provider.headers,
    };

    let response = await fetchFn(provider.url, {
      method: "HEAD",
      signal: getRemainingSignal(),
      headers: baseHeaders,
    }).catch(async (headError) => {
      if (performance.now() >= deadline) throw headError;
      return fetchFn(provider.url, {
        method: "GET",
        signal: getRemainingSignal(),
        headers: baseHeaders,
      });
    });

    if ((response.status === 405 || response.status === 501) && performance.now() < deadline) {
      response = await fetchFn(provider.url, {
        method: "GET",
        signal: getRemainingSignal(),
        headers: baseHeaders,
      }).catch(() => response);
    }

    const latencyMs = Math.round(performance.now() - start);

    if (response.ok || (response.status >= 200 && response.status < 400)) {
      return {
        id: provider.id,
        name: provider.name,
        category: provider.category,
        configured: true,
        status: "ONLINE",
        latencyMs,
        notes: `HTTP ${response.status}`,
      };
    }

    if (response.status === 403 || response.status === 503) {
      const serverHeader = response.headers.get("server") ?? "";
      const isCloudflare = serverHeader.toLowerCase().includes("cloudflare");
      return {
        id: provider.id,
        name: provider.name,
        category: provider.category,
        configured: true,
        status: isCloudflare ? "CLOUDFLARE" : "DEGRADED",
        latencyMs,
        notes: isCloudflare ? "Cloudflare challenge/protection active" : `HTTP ${response.status}`,
      };
    }

    return {
      id: provider.id,
      name: provider.name,
      category: provider.category,
      configured: true,
      status: "DEGRADED",
      latencyMs,
      notes: `HTTP ${response.status}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      message.toLowerCase().includes("timeout") || message.toLowerCase().includes("aborted");
    return {
      id: provider.id,
      name: provider.name,
      category: provider.category,
      configured: true,
      status: "OFFLINE",
      latencyMs: isTimeout ? null : latencyMs,
      notes: isTimeout ? "Probe timed out" : message.slice(0, 35),
    };
  }
}

/**
 * Probes Real-Debrid service using configured token via RealDebridClient.
 */
async function probeRealDebrid(
  token: string | undefined,
  fetchFn: ProviderStatusFetch,
  timeoutMs: number,
): Promise<ProviderStatusEntry> {
  if (!token) {
    return {
      id: "real-debrid",
      name: "Real-Debrid",
      category: "debrid",
      configured: false,
      status: "UNCONFIGURED",
      latencyMs: null,
      notes: "Set REAL_DEBRID_API_KEY in env or setup",
    };
  }

  const start = performance.now();
  try {
    const client = new RealDebridClient({ token, fetch: fetchFn, timeoutMs });
    const user = await client.getUser();
    const latencyMs = Math.round(performance.now() - start);
    return {
      id: "real-debrid",
      name: "Real-Debrid",
      category: "debrid",
      configured: true,
      status: "ONLINE",
      latencyMs,
      notes: `${user.premium ? "Premium" : "Free"} account (${user.username || "user"})`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    if (error instanceof DebridAuthError) {
      return {
        id: "real-debrid",
        name: "Real-Debrid",
        category: "debrid",
        configured: true,
        status: "AUTH_ERROR",
        latencyMs,
        notes: error.message.slice(0, 35) || "Invalid API token",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      message.toLowerCase().includes("timeout") || message.toLowerCase().includes("aborted");
    return {
      id: "real-debrid",
      name: "Real-Debrid",
      category: "debrid",
      configured: true,
      status: "OFFLINE",
      latencyMs: isTimeout ? null : latencyMs,
      notes: isTimeout ? "Probe timed out" : message.slice(0, 35),
    };
  }
}

/**
 * Probes AllDebrid service using configured token via AllDebridClient.
 */
async function probeAllDebrid(
  token: string | undefined,
  fetchFn: ProviderStatusFetch,
  timeoutMs: number,
): Promise<ProviderStatusEntry> {
  if (!token) {
    return {
      id: "all-debrid",
      name: "AllDebrid",
      category: "debrid",
      configured: false,
      status: "UNCONFIGURED",
      latencyMs: null,
      notes: "Set ALLDEBRID_API_KEY in env or setup",
    };
  }

  const start = performance.now();
  try {
    const client = new AllDebridClient({ token, fetch: fetchFn, timeoutMs });
    const user = await client.getUser();
    const latencyMs = Math.round(performance.now() - start);
    return {
      id: "all-debrid",
      name: "AllDebrid",
      category: "debrid",
      configured: true,
      status: "ONLINE",
      latencyMs,
      notes: `${user.premium ? "Premium" : "Free"} account (${user.username || "user"})`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    if (error instanceof DebridAuthError) {
      return {
        id: "all-debrid",
        name: "AllDebrid",
        category: "debrid",
        configured: true,
        status: "AUTH_ERROR",
        latencyMs,
        notes: error.message.slice(0, 35) || "Invalid API key",
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout =
      message.toLowerCase().includes("timeout") || message.toLowerCase().includes("aborted");
    return {
      id: "all-debrid",
      name: "AllDebrid",
      category: "debrid",
      configured: true,
      status: "OFFLINE",
      latencyMs: isTimeout ? null : latencyMs,
      notes: isTimeout ? "Probe timed out" : message.slice(0, 35),
    };
  }
}

/**
 * Checks YouTube platform provider status via network probe and bounded yt-dlp binary probe.
 */
async function probeYouTube(
  fetchFn: ProviderStatusFetch,
  timeoutMs: number,
  getEnv?: (key: string) => string | undefined,
): Promise<ProviderStatusEntry> {
  const start = performance.now();
  let ytDlpVersion: string | null = null;

  try {
    const customPath = getEnv?.("PATH");
    const ytDlpBinary = Bun.which(
      "yt-dlp",
      customPath !== undefined ? { PATH: customPath } : undefined,
    );
    if (ytDlpBinary) {
      const proc = Bun.spawn([ytDlpBinary, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(
          () => {
            try {
              proc.kill();
            } catch {
              // Process already ended
            }
            resolve(null);
          },
          Math.min(timeoutMs, 2000),
        );
      });

      const readPromise = (async () => {
        const versionText = (await new Response(proc.stdout).text()).trim();
        const exitCode = await proc.exited;
        return exitCode === 0 && versionText ? versionText : null;
      })();

      ytDlpVersion = await Promise.race([readPromise, timeoutPromise]);
    }
  } catch {
    ytDlpVersion = null;
  }

  const ytProbeUrl =
    "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=kunai";
  try {
    const res = await fetchFn(ytProbeUrl, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    const latencyMs = Math.round(performance.now() - start);

    if (res.ok || (res.status >= 200 && res.status < 400)) {
      const note = ytDlpVersion ? `yt-dlp ${ytDlpVersion}` : "yt-dlp not on PATH";
      return {
        id: "youtube",
        name: "YouTube",
        category: "platform",
        configured: true,
        status: ytDlpVersion ? "ONLINE" : "DEGRADED",
        latencyMs,
        notes: note,
      };
    }

    return {
      id: "youtube",
      name: "YouTube",
      category: "platform",
      configured: true,
      status: "DEGRADED",
      latencyMs,
      notes: `HTTP ${res.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.toLowerCase().includes("timeout") || message.toLowerCase().includes("aborted");
    return {
      id: "youtube",
      name: "YouTube",
      category: "platform",
      configured: ytDlpVersion !== null,
      status: "OFFLINE",
      latencyMs: isTimeout ? null : latencyMs,
      notes: isTimeout
        ? "Network timeout"
        : ytDlpVersion
          ? `yt-dlp ${ytDlpVersion}`
          : message.slice(0, 35),
    };
  }
}

export async function buildProviderStatusReport(
  options: RunProviderStatusOptions = {},
): Promise<ProviderStatusReport> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const getEnv = options.getEnv ?? ((key: string) => process.env[key]);

  // Read possible tokens from env or config file
  let rdToken =
    getEnv("REAL_DEBRID_API_KEY") ||
    getEnv("REAL_DEBRID_TOKEN") ||
    getEnv("KUNAI_REAL_DEBRID_TOKEN");
  let adToken =
    getEnv("ALLDEBRID_API_KEY") || getEnv("ALL_DEBRID_TOKEN") || getEnv("KUNAI_ALLDEBRID_TOKEN");

  if (!rdToken || !adToken) {
    try {
      const configPath = options.configPath ?? getKunaiPaths().configPath;
      const file = Bun.file(configPath);
      if (await file.exists()) {
        // SAFETY: config JSON file optionally contains user debrid API keys
        const parsed = (await file.json()) as {
          realDebridApiKey?: string;
          allDebridApiKey?: string;
        };
        if (!rdToken && parsed.realDebridApiKey) rdToken = parsed.realDebridApiKey;
        if (!adToken && parsed.allDebridApiKey) adToken = parsed.allDebridApiKey;
      }
    } catch {
      // Ignore config file read errors
    }
  }

  const youtubeProbePromise = options.probeYouTube
    ? options.probeYouTube()
    : probeYouTube(fetchFn, timeoutMs, getEnv);

  const probePromises: Promise<ProviderStatusEntry>[] = [
    probeRealDebrid(rdToken, fetchFn, timeoutMs),
    probeAllDebrid(adToken, fetchFn, timeoutMs),
    youtubeProbePromise,
    ...KNOWN_HTTP_PROVIDERS.map((p) => probeHttpProvider(p, fetchFn, timeoutMs)),
  ];

  const results = await Promise.all(probePromises);
  const onlineCount = results.filter((r) => r.status === "ONLINE").length;

  return {
    timestamp: new Date().toISOString(),
    total: results.length,
    online: onlineCount,
    entries: results,
  };
}

/**
 * Formats report as an ANSI table for TTY or ASCII table for pipes.
 */
export function formatProviderStatusTable(
  report: ProviderStatusReport,
  options: { readonly isTty?: boolean; readonly noColor?: boolean } = {},
): string {
  const useColor =
    (options.isTty ?? Boolean(process.stdout.isTTY)) && !options.noColor && !process.env.NO_COLOR;

  const colWidths = {
    name: 18,
    category: 14,
    configured: 12,
    status: 14,
    latency: 10,
    notes: 34,
  };

  const pad = (str: string, width: number) => {
    return str.length >= width
      ? str.slice(0, width - 1) + " "
      : str + " ".repeat(width - str.length);
  };

  const colorizeStatus = (status: ProviderStatusLevel, text: string) => {
    if (!useColor) return text;
    switch (status) {
      case "ONLINE":
        return `\x1b[32m${text}\x1b[0m`;
      case "CLOUDFLARE":
        return `\x1b[36m${text}\x1b[0m`;
      case "UNCONFIGURED":
        return `\x1b[33m${text}\x1b[0m`;
      case "DEGRADED":
        return `\x1b[33m${text}\x1b[0m`;
      case "AUTH_ERROR":
      case "OFFLINE":
        return `\x1b[31m${text}\x1b[0m`;
      default:
        return text;
    }
  };

  const bold = (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text);
  const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text);

  const header =
    pad("Provider / Service", colWidths.name) +
    pad("Category", colWidths.category) +
    pad("Configured", colWidths.configured) +
    pad("Status", colWidths.status) +
    pad("Latency", colWidths.latency) +
    pad("Notes", colWidths.notes);

  const divider = "─".repeat(Object.values(colWidths).reduce((a, b) => a + b, 0));

  const lines: string[] = [
    bold("Kunai Provider & Debrid Status"),
    dim(`Probed at ${report.timestamp} — ${report.online}/${report.total} services reachable`),
    divider,
    bold(header),
    divider,
  ];

  for (const entry of report.entries) {
    const configuredText = entry.configured ? "YES" : "NO";
    const latencyText = entry.latencyMs !== null ? `${entry.latencyMs}ms` : "-";
    const statusFormatted = colorizeStatus(entry.status, pad(entry.status, colWidths.status));

    const row =
      pad(entry.name, colWidths.name) +
      pad(entry.category, colWidths.category) +
      pad(configuredText, colWidths.configured) +
      statusFormatted +
      pad(latencyText, colWidths.latency) +
      pad(entry.notes, colWidths.notes);

    lines.push(row);
  }

  lines.push(divider);
  return lines.join("\n");
}

/**
 * CLI execution handler for `kunai status` / `kunai providers status`.
 */
export async function runProviderStatusCommand(
  argv: readonly string[] = [],
  options: RunProviderStatusOptions = {},
): Promise<number> {
  const isJson = options.json ?? argv.includes("--json");
  const report = await buildProviderStatusReport(options);

  if (isJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatProviderStatusTable(report, options) + "\n");
  }

  return 0;
}
