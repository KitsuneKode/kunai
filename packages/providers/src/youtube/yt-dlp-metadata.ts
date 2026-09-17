import { youtubeQualityHeight } from "./quality-selection";
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
  readonly timestamp?: number;
  readonly release_timestamp?: number;
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
  readonly poToken?: string;
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
  // yt-dlp's default format selector is `bv*+ba/b`. Adding `/ba` ensures
  // audio-only tracks, music, and podcasts without video streams resolve cleanly.
  return "bv*+ba/b/ba";
}

export function buildYtdlFormatSelector(qualityLabel?: string): string {
  if (!qualityLabel) return defaultYtdlPlaybackFormat();
  const height = youtubeQualityHeight(qualityLabel);
  if (!height) return defaultYtdlPlaybackFormat();
  // `height<=?H` keeps formats whose height YouTube did not report (live HLS
  // renditions, mainly) instead of rejecting them. The ceiling is repeated on the
  // second alternative on purpose: without it a failed merge silently promotes the
  // viewer to the best available rendition, so asking for 480p could yield 2160p.
  return `bv*[height<=?${height}]+ba/bv*[height<=?${height}]/${defaultYtdlPlaybackFormat()}`;
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
