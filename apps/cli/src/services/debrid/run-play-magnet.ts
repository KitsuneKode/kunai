import { launchMpv } from "@/mpv";
import {
  AllDebridClient,
  RealDebridClient,
  DebridNotCachedError,
  DebridAuthError,
  DebridError,
} from "@kunai/providers/debrid";
import { getKunaiPaths } from "@kunai/storage";

export interface PlayMagnetOptions {
  readonly service?: "real-debrid" | "all-debrid";
  readonly getEnv?: (key: string) => string | undefined;
  readonly configPath?: string;
  readonly fetchFn?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  readonly dryRun?: boolean;
}

export function isMagnetOrTorrentHash(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.startsWith("magnet:?")) return true;
  if (/^[a-fA-F0-9]{40}$/.test(trimmed) || /^[a-fA-F0-9]{64}$/.test(trimmed)) return true;
  return false;
}

export function normalizeMagnetUri(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("magnet:?")) return trimmed;
  if (/^[a-fA-F0-9]{40}$/.test(trimmed)) {
    return `magnet:?xt=urn:btih:${trimmed}`;
  }
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return `magnet:?xt=urn:btmh:1220${trimmed}`;
  }
  return trimmed;
}

export async function runPlayMagnetCommand(
  magnetInput: string,
  options: PlayMagnetOptions = {},
): Promise<number> {
  const getEnv = options.getEnv ?? ((key: string) => process.env[key]);
  const magnet = normalizeMagnetUri(magnetInput);

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

  if (!rdToken && !adToken) {
    process.stderr.write(
      "kunai: Magnet URI detected, but no Debrid service is configured.\n" +
        "Configure Real-Debrid or AllDebrid via environment variables:\n" +
        '  export REAL_DEBRID_API_KEY="your-token"\n' +
        '  export ALLDEBRID_API_KEY="your-token"\n' +
        "or configure credentials via 'kunai --setup'.\n",
    );
    return 1;
  }

  const preferredService = options.service ?? (rdToken ? "real-debrid" : "all-debrid");
  const serviceName = preferredService === "real-debrid" ? "Real-Debrid" : "AllDebrid";
  const token = preferredService === "real-debrid" ? rdToken : adToken;

  if (!token) {
    process.stderr.write(`kunai: ${serviceName} is selected but no API token is configured.\n`);
    return 1;
  }

  const client =
    preferredService === "real-debrid"
      ? new RealDebridClient(options.fetchFn ? { token, fetch: options.fetchFn } : { token })
      : new AllDebridClient(options.fetchFn ? { token, fetch: options.fetchFn } : { token });

  process.stdout.write(`Resolving magnet stream via ${serviceName}...\n`);

  try {
    const result = await client.resolveStream(magnet);
    const sizeMb =
      Number.isFinite(result.stream.filesize) && result.stream.filesize > 0
        ? `${(result.stream.filesize / (1024 * 1024)).toFixed(1)} MB`
        : "Unknown size";
    const quality = result.stream.quality ?? "Direct";

    process.stdout.write(
      `Stream resolved:\n` +
        `  Title:   ${result.stream.filename}\n` +
        `  Size:    ${sizeMb}\n` +
        `  Quality: ${quality}\n` +
        `  Service: ${result.service}\n`,
    );

    // Verify stream URL is reachable before proceeding
    const fetchFn = options.fetchFn ?? fetch;
    try {
      const probe = await fetchFn(result.stream.url, {
        method: "HEAD",
        signal: AbortSignal.timeout(6000),
      }).catch(async () =>
        fetchFn(result.stream.url, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          signal: AbortSignal.timeout(6000),
        }),
      );

      if (!probe.ok && probe.status !== 206) {
        process.stderr.write(
          `kunai: Resolved stream URL returned HTTP ${probe.status} and is unreachable.\n`,
        );
        return 1;
      }
    } catch (probeErr) {
      const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
      process.stderr.write(`kunai: Failed to verify stream reachability: ${msg}\n`);
      return 1;
    }

    if (options.dryRun) {
      process.stdout.write(`[dry-run] URL: ${result.stream.url}\n`);
      return 0;
    }

    process.stdout.write("Launching mpv player...\n");
    await launchMpv({
      url: result.stream.url,
      displayTitle: result.stream.filename,
      headers: {},
      subtitle: null,
    });

    return 0;
  } catch (error) {
    if (error instanceof DebridNotCachedError) {
      process.stderr.write(
        `kunai: Torrent is not currently cached on ${serviceName}.\n` +
          `Kunai requires instant cached availability to stream directly. Try another source or hash.\n`,
      );
      return 1;
    }
    if (error instanceof DebridAuthError) {
      process.stderr.write(
        `kunai: Authentication failed for ${serviceName}. Verify your API token.\n`,
      );
      return 1;
    }
    if (error instanceof DebridError) {
      process.stderr.write(`kunai: Debrid error (${error.code}): ${error.message}\n`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`kunai: Failed to resolve debrid stream: ${message}\n`);
    return 1;
  }
}
