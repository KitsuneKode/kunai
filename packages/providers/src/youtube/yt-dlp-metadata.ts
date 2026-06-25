import { spawnYtDlpWithTimeout } from "./spawn-ytdlp";
import { buildYoutubeYtdlCliArgs } from "./ytdl-options";

export type YtDlpFormatInfo = {
  readonly format_id?: string;
  readonly ext?: string;
  readonly height?: number;
  readonly width?: number;
  readonly vcodec?: string;
  readonly acodec?: string;
  readonly tbr?: number;
  readonly format?: string;
  readonly protocol?: string;
  readonly url?: string;
};

export type YtDlpVideoInfo = {
  readonly id?: string;
  readonly title?: string;
  readonly duration?: number;
  readonly thumbnail?: string;
  readonly uploader?: string;
  readonly channel_id?: string;
  readonly view_count?: number;
  readonly upload_date?: string;
  readonly is_live?: boolean;
  readonly live_status?: string;
  readonly formats?: readonly YtDlpFormatInfo[];
  readonly subtitles?: Record<string, readonly { readonly ext?: string; readonly url?: string }[]>;
  readonly automatic_captions?: Record<
    string,
    readonly { readonly ext?: string; readonly url?: string }[]
  >;
};

export type YtDlpExtractOptions = {
  readonly cookiesFromBrowser?: string;
  readonly cookiesFile?: string;
  readonly extractorArgs?: string;
  readonly sponsorblockRemove?: string;
  readonly isLive?: boolean;
  readonly signal?: AbortSignal;
};

export async function extractYtDlpVideoInfo(
  watchUrl: string,
  options: YtDlpExtractOptions = {},
): Promise<YtDlpVideoInfo> {
  const args = [
    "-J",
    "--no-download",
    "--no-warnings",
    "--no-playlist",
    ...buildYoutubeYtdlCliArgs(options),
  ];
  args.push(watchUrl);

  const proc = await spawnYtDlpWithTimeout({ args, signal: options.signal });

  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.trim() || `yt-dlp exited with code ${proc.exitCode}`);
  }
  return JSON.parse(proc.stdout) as YtDlpVideoInfo;
}

export function defaultYtdlPlaybackFormat(): string {
  return "bv*+ba/b";
}

export function buildYtdlFormatSelector(qualityLabel?: string): string {
  if (!qualityLabel) return defaultYtdlPlaybackFormat();
  const normalized = qualityLabel.trim().toLowerCase();
  if (normalized === "best" || normalized === "auto" || normalized === "") {
    return defaultYtdlPlaybackFormat();
  }
  const match = qualityLabel.match(/(\d{3,4})\s*p/i);
  if (!match?.[1]) return defaultYtdlPlaybackFormat();
  const height = Number.parseInt(match[1], 10);
  if (!Number.isFinite(height) || height <= 0) return defaultYtdlPlaybackFormat();
  return `best[height<=${height}]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;
}

export function mapYtDlpFormatsToQualityLabels(
  formats: readonly YtDlpFormatInfo[] | undefined,
): readonly { readonly label: string; readonly rank: number; readonly formatId: string }[] {
  const videoFormats = (formats ?? []).filter(
    (format) => typeof format.height === "number" && format.height > 0 && format.vcodec !== "none",
  );
  const seen = new Set<number>();
  const ranked: { readonly label: string; readonly rank: number; readonly formatId: string }[] = [];
  for (const format of videoFormats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))) {
    const height = format.height ?? 0;
    if (seen.has(height)) continue;
    seen.add(height);
    ranked.push({
      label: `${height}p`,
      rank: height,
      formatId: format.format_id ?? `${height}p`,
    });
  }
  return ranked;
}
