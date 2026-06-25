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
