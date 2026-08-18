import { spawnYtDlpWithTimeout } from "@kunai/providers/youtube";

export {
  buildYtdlFormatSelector,
  defaultYtdlPlaybackFormat,
  extractYtDlpVideoInfo,
  mapYtDlpFormatsToQualityLabels,
  type YtDlpExtractOptions,
  type YtDlpFormatInfo,
  type YtDlpVideoInfo,
} from "@kunai/providers/youtube";

export function probeYtDlp(): { readonly available: boolean; readonly version?: string } {
  const path = Bun.which("yt-dlp");
  if (!path) return { available: false };
  return { available: true };
}

export type YtDlpPluginProbe = {
  /** yt-dlp answered the probe at all. */
  readonly available: boolean;
  /** A PO Token provider plugin (e.g. bgutil) is loaded. */
  readonly poTokenProvider: boolean;
  /** Plugin names yt-dlp reported, for diagnostics. */
  readonly plugins: readonly string[];
};

/**
 * Ask yt-dlp which plugins it loaded.
 *
 * YouTube requires a Proof-of-Origin token for GVS (media) requests on most player
 * clients; without one, media URLs can answer 403 even though extraction succeeded.
 * yt-dlp cannot mint these itself — it needs a provider plugin — so knowing whether
 * one is installed is the difference between diagnosing a 403 and guessing at it.
 *
 * `ytsearch0:` resolves to an empty result set, so this costs no real extraction.
 */
export async function probeYtDlpPlugins(): Promise<YtDlpPluginProbe> {
  if (!Bun.which("yt-dlp")) return { available: false, poTokenProvider: false, plugins: [] };
  try {
    const proc = await spawnYtDlpWithTimeout({
      args: ["--verbose", "--simulate", "ytsearch0:x"],
      timeoutMs: 15_000,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 256 * 1024,
    });
    // yt-dlp writes its debug banner to stderr.
    return parseYtDlpPluginProbe(`${proc.stderr}\n${proc.stdout}`);
  } catch {
    return { available: false, poTokenProvider: false, plugins: [] };
  }
}

/** Exported for tests: parse the `--verbose` debug banner. */
export function parseYtDlpPluginProbe(output: string): YtDlpPluginProbe {
  const plugins = new Set<string>();
  let poTokenProvider = false;

  for (const line of output.split("\n")) {
    const providers = line.match(/\[pot\]\s*PO Token Providers:\s*(.+)$/i);
    if (providers?.[1]) {
      const named = providers[1].trim();
      if (named && named.toLowerCase() !== "none") {
        poTokenProvider = true;
        for (const entry of named.split(",")) {
          const name = entry.trim();
          if (name) plugins.add(name);
        }
      }
      continue;
    }
    const extractor = line.match(/(?:Extractor|Postprocessor) Plugins:\s*(.+)$/i);
    if (extractor?.[1]) {
      const named = extractor[1].trim();
      if (named && named.toLowerCase() !== "none") {
        for (const entry of named.split(",")) {
          const name = entry.trim();
          if (name) plugins.add(name);
          // The bgutil provider registers as an extractor plugin and is the
          // community-standard PO Token source, so it counts as one.
          if (/bgutil|pot|po.?token/i.test(name)) poTokenProvider = true;
        }
      }
    }
  }

  return { available: true, poTokenProvider, plugins: [...plugins] };
}

export async function probeYtDlpAsync(): Promise<{
  readonly available: boolean;
  readonly version?: string;
}> {
  const path = Bun.which("yt-dlp");
  if (!path) return { available: false };
  try {
    const proc = await spawnYtDlpWithTimeout({
      args: ["--version"],
      timeoutMs: 8_000,
      maxStdoutBytes: 4 * 1024,
      maxStderrBytes: 4 * 1024,
    });
    if (proc.exitCode !== 0) return { available: false };
    return { available: true, version: proc.stdout.trim() };
  } catch {
    return { available: false };
  }
}
