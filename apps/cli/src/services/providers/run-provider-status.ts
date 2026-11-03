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
  readonly isTty?: boolean;
  readonly noColor?: boolean;
}

const DEFAULT_TIMEOUT_MS = 4000;

const KNOWN_HTTP_PROVIDERS: readonly {
  readonly id: string;
  readonly name: string;
  readonly category: ProviderCategory;
  readonly domain: string;
  readonly probePath?: string;
}[] = [
  { id: "hianime", name: "HiAnime", category: "anime", domain: "hianime.at" },
  { id: "miruro", name: "Miruro", category: "anime", domain: "miruro.to" },
  { id: "allmanga", name: "AllManga", category: "anime", domain: "allmanga.to" },
  { id: "animegg", name: "AnimeGG", category: "anime", domain: "animegg.org" },
  { id: "kickassanime", name: "KickAssAnime", category: "anime", domain: "kickassanime.am" },
  { id: "vidrock", name: "VidRock", category: "movie/series", domain: "vidrock.net" },
  { id: "vidlink", name: "VidLink", category: "movie/series", domain: "vidlink.pro" },
  { id: "videasy", name: "Videasy", category: "movie/series", domain: "player.videasy.net" },
  { id: "rivestream", name: "Rivestream", category: "movie/series", domain: "rivestream.live" },
  { id: "movy", name: "Movy", category: "movie/series", domain: "movy.stream" },
];

/**
 * Probes a direct HTTP web provider domain with a short timeout.
 */
async function probeHttpProvider(
  provider: (typeof KNOWN_HTTP_PROVIDERS)[number],
  fetchFn: ProviderStatusFetch,
  timeoutMs: number,
): Promise<ProviderStatusEntry> {
  const url = `https://${provider.domain}${provider.probePath ?? "/"}`;
  const start = performance.now();
  try {
    const response = await fetchFn(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      },
    }).catch(async () => {
      // Some CDNs reject HEAD (405) — fallback to lightweight GET
      return fetchFn(url, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
      });
    });

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
 * Probes Real-Debrid service using configured token.
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
    const res = await fetchFn("https://api.real-debrid.com/rest/1.0/user", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (res.status === 401 || res.status === 403) {
      return {
        id: "real-debrid",
        name: "Real-Debrid",
        category: "debrid",
        configured: true,
        status: "AUTH_ERROR",
        latencyMs,
        notes: "Invalid or expired API token",
      };
    }
    if (res.ok) {
      // SAFETY: Real-Debrid API /user endpoint returns JSON with account info
      const data = (await res.json()) as { username?: string; type?: string; expiration?: string };
      const isPremium = data.type === "premium";
      return {
        id: "real-debrid",
        name: "Real-Debrid",
        category: "debrid",
        configured: true,
        status: "ONLINE",
        latencyMs,
        notes: `${isPremium ? "Premium" : "Free"} account (${data.username ?? "user"})`,
      };
    }
    return {
      id: "real-debrid",
      name: "Real-Debrid",
      category: "debrid",
      configured: true,
      status: "DEGRADED",
      latencyMs,
      notes: `HTTP ${res.status}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      id: "real-debrid",
      name: "Real-Debrid",
      category: "debrid",
      configured: true,
      status: "OFFLINE",
      latencyMs,
      notes: error instanceof Error ? error.message.slice(0, 35) : "Network error",
    };
  }
}

/**
 * Probes AllDebrid service using configured token.
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
    const res = await fetchFn("https://api.alldebrid.com/v4/user?agent=kunai", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (res.status === 401 || res.status === 403) {
      return {
        id: "all-debrid",
        name: "AllDebrid",
        category: "debrid",
        configured: true,
        status: "AUTH_ERROR",
        latencyMs,
        notes: "Invalid or expired API token",
      };
    }
    if (res.ok) {
      // SAFETY: AllDebrid API /user endpoint returns JSON with user data
      const data = (await res.json()) as {
        status?: string;
        data?: { user?: { username?: string; isPremium?: boolean } };
      };
      const user = data.data?.user;
      return {
        id: "all-debrid",
        name: "AllDebrid",
        category: "debrid",
        configured: true,
        status: "ONLINE",
        latencyMs,
        notes: `${user?.isPremium ? "Premium" : "Free"} account (${user?.username ?? "user"})`,
      };
    }
    return {
      id: "all-debrid",
      name: "AllDebrid",
      category: "debrid",
      configured: true,
      status: "DEGRADED",
      latencyMs,
      notes: `HTTP ${res.status}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      id: "all-debrid",
      name: "AllDebrid",
      category: "debrid",
      configured: true,
      status: "OFFLINE",
      latencyMs,
      notes: error instanceof Error ? error.message.slice(0, 35) : "Network error",
    };
  }
}

/**
 * Checks YouTube platform provider status via yt-dlp probe.
 */
async function probeYouTube(): Promise<ProviderStatusEntry> {
  try {
    const proc = Bun.spawn(["yt-dlp", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const versionText = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    if (exitCode === 0 && versionText) {
      return {
        id: "youtube",
        name: "YouTube",
        category: "platform",
        configured: true,
        status: "ONLINE",
        latencyMs: null,
        notes: `yt-dlp ${versionText}`,
      };
    }
    return {
      id: "youtube",
      name: "YouTube",
      category: "platform",
      configured: false,
      status: "DEGRADED",
      latencyMs: null,
      notes: "yt-dlp exited with error",
    };
  } catch {
    return {
      id: "youtube",
      name: "YouTube",
      category: "platform",
      configured: false,
      status: "OFFLINE",
      latencyMs: null,
      notes: "yt-dlp not found on PATH",
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
      const configPath = getKunaiPaths().configPath;
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

  const probePromises: Promise<ProviderStatusEntry>[] = [
    probeRealDebrid(rdToken, fetchFn, timeoutMs),
    probeAllDebrid(adToken, fetchFn, timeoutMs),
    probeYouTube(),
    ...KNOWN_HTTP_PROVIDERS.map((p) => probeHttpProvider(p, fetchFn, timeoutMs)),
  ];

  const results = await Promise.all(probePromises);
  const onlineCount = results.filter(
    (r) => r.status === "ONLINE" || r.status === "CLOUDFLARE",
  ).length;

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
