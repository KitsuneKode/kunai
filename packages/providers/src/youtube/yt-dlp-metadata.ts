import { isJsonString } from "@kunai/types";

import { youtubeQualityHeight } from "./quality-selection";
import { spawnYtDlpWithTimeout, type YtDlpSpawn } from "./spawn-ytdlp";
import { buildYoutubeYtdlCliArgs } from "./ytdl-options";

export type YtDlpFormatInfo = {
  readonly format_id?: string;
  readonly ext?: string;
  readonly height?: number;
  readonly width?: number;
  readonly vcodec?: string;
  readonly acodec?: string;
  readonly tbr?: number;
  readonly fps?: number;
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
  /** Seam for tests: observe/replace the yt-dlp spawn. Production omits it. */
  readonly spawn?: YtDlpSpawn;
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
  // The watch URL is provider/catalog-influenced. `--` before it makes a
  // watchUrl beginning with `-` a target, not an injected yt-dlp option.
  args.push("--", watchUrl);

  const proc = await spawnYtDlpWithTimeout({ args, signal: options.signal, spawn: options.spawn });

  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.trim() || `yt-dlp exited with code ${proc.exitCode}`);
  }
  return JSON.parse(proc.stdout) as YtDlpVideoInfo;
}

export function defaultYtdlPlaybackFormat(): string {
  // yt-dlp's own documented default. `bv*` means "best format that contains
  // video" — `bv`/`bestvideo` is video-*only* (`best*[acodec=none]`), which drops
  // the pre-merged renditions YouTube serves for live HLS and for older uploads.
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

/** Pin a discovered rendition. Never silently replace a missing exact format with best. */
export function buildExactYtdlFormatSelector(formatId: string, hasAudio?: boolean): string {
  if (!/^[\w.-]+$/.test(formatId)) throw new Error("Invalid YouTube format id");
  if (hasAudio === true) return formatId;
  if (hasAudio === false) return `${formatId}+ba`;
  return `${formatId}+ba/${formatId}`;
}

function codecLabel(codec: string | undefined): string | undefined {
  if (!codec || codec === "none") return undefined;
  if (/^avc/i.test(codec)) return "H.264";
  if (/^(hev|hvc)/i.test(codec)) return "HEVC";
  if (/^vp0?9/i.test(codec)) return "VP9";
  if (/^av0?1/i.test(codec)) return "AV1";
  return codec;
}

export function mapYtDlpFormatsToQualityLabels(
  formats: readonly YtDlpFormatInfo[] | undefined,
): readonly import("./youtube-metadata").YoutubeVideoQuality[] {
  const videoFormats = (formats ?? []).filter(
    (format): format is YtDlpFormatInfo & { readonly height: number; readonly format_id: string } =>
      Number.isFinite(format.height) &&
      (format.height ?? 0) > 0 &&
      isJsonString(format.vcodec) &&
      format.vcodec !== "none" &&
      isJsonString(format.format_id) &&
      /^[\w.-]+$/.test(format.format_id),
  );
  // Prefer height, direct HTTPS/DASH over fragmented HLS (which desyncs with direct audio),
  // then frame rate and bitrate; id breaks ties deterministically.
  videoFormats.sort((a, b) => {
    const aM3u8 = a.protocol?.startsWith("m3u8") ? 1 : 0;
    const bM3u8 = b.protocol?.startsWith("m3u8") ? 1 : 0;
    return (
      (b.height ?? 0) - (a.height ?? 0) ||
      aM3u8 - bM3u8 ||
      (b.fps ?? 0) - (a.fps ?? 0) ||
      (b.tbr ?? 0) - (a.tbr ?? 0) ||
      (a.format_id ?? "").localeCompare(b.format_id ?? "")
    );
  });
  const seen = new Set<string>();
  return videoFormats.flatMap((format) => {
    const formatId = format.format_id;
    if (seen.has(formatId)) return [];
    seen.add(formatId);
    const height = format.height;
    const fps =
      Number.isFinite(format.fps) && (format.fps ?? 0) > 0 ? `${format.fps}fps` : undefined;
    const bitrate =
      Number.isFinite(format.tbr) && (format.tbr ?? 0) > 0
        ? `${Number(((format.tbr ?? 0) / 1000).toFixed(2))} Mb/s`
        : undefined;
    return [
      {
        label: [`${height}p`, codecLabel(format.vcodec), fps, bitrate, `#${formatId}`]
          .filter(Boolean)
          .join(" · "),
        rank: height,
        formatId,
        hasAudio: format.acodec ? format.acodec !== "none" : undefined,
      },
    ];
  });
}
