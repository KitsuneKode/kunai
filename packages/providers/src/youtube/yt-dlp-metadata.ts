import { isJsonString } from "@kunai/types";

import { youtubeQualityHeight } from "./quality-selection";
import { spawnYtDlpWithTimeout, type YtDlpSpawn } from "./spawn-ytdlp";
import type { YoutubeVideoQuality } from "./youtube-metadata";
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
  readonly dynamic_range?: string;
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

/**
 * Map Kunai's audio preference to a yt-dlp audio selector fragment.
 *
 * `original` (and unset/`auto`/`sub`) emits plain `ba`, which picks YouTube's
 * original audio track. Explicit language codes prefer tracks whose `language`
 * starts with that code (`ba[language^=ja]/ba`) because mpv 0.42's ytdl hook
 * does not reliably populate per-track `lang` metadata for `--alang`. `dub`
 * prefers any non-original audio track with a safe fallback to `ba`.
 */
export function buildYoutubeAudioSelector(audioPreference?: string): string {
  const raw = audioPreference?.trim().toLowerCase();
  if (!raw || raw === "original" || raw === "auto" || raw === "sub") return "ba";
  if (raw === "dub") return "(ba[format_note!*='original']/ba)";
  // Reject arbitrary yt-dlp filter characters so config/user input cannot inject selector logic.
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/.test(raw)) return "ba";
  return `(ba[language^=${raw}]/ba)`;
}

export function defaultYtdlPlaybackFormat(audioPreference?: string): string {
  // yt-dlp's own documented default. `bv*` means "best format that contains
  // video" — `bv`/`bestvideo` is video-*only* (`best*[acodec=none]`), which drops
  // the pre-merged renditions YouTube serves for live HLS and for older uploads.
  const audio = buildYoutubeAudioSelector(audioPreference);
  return `bv*+${audio}/b/${audio}`;
}

export function buildYtdlFormatSelector(qualityLabel?: string, audioPreference?: string): string {
  const fallback = defaultYtdlPlaybackFormat(audioPreference);
  if (!qualityLabel) return fallback;
  const ceiling = youtubeQualityHeight(qualityLabel);
  if (!ceiling) return fallback;
  // Filter by short side (`min(width, height)`): landscape formats have
  // `aspect_ratio >= 1` (short side is height), portrait Shorts have
  // `aspect_ratio < 1` (short side is width), and formats with unknown
  // dimensions fall through to `height<=?ceiling` (live HLS, mainly). Repeating
  // the capped selector before the fallback avoids silently promoting a failed
  // merge above the requested ceiling.
  const video = `(bv*[height<=${ceiling}][aspect_ratio>=1]/bv*[width<=${ceiling}][aspect_ratio<1]/bv*[height<=?${ceiling}])`;
  const audio = buildYoutubeAudioSelector(audioPreference);
  return `${video}+${audio}/${video}/${fallback}`;
}

/** Pin a discovered rendition. Never silently replace a missing exact format with best. */
export function buildExactYtdlFormatSelector(
  formatId: string,
  hasAudio?: boolean,
  audioPreference?: string,
): string {
  if (!/^[\w.-]+$/.test(formatId)) throw new Error("Invalid YouTube format id");
  if (hasAudio === true) return formatId;
  const audio = buildYoutubeAudioSelector(audioPreference);
  if (hasAudio === false) return `${formatId}+${audio}`;
  return `${formatId}+${audio}/${formatId}`;
}

/** Whether a yt-dlp format protocol is HLS (manifest-based, slower startup/seeks than HTTPS DASH). */
export function isYoutubeHlsProtocol(protocol: string | undefined): boolean {
  return isJsonString(protocol) && /^m3u8/i.test(protocol.trim());
}

function effectiveResolution(
  format: Pick<YtDlpFormatInfo, "width" | "height">,
): number | undefined {
  const height =
    Number.isFinite(format.height) && (format.height ?? 0) > 0 ? format.height : undefined;
  const width = Number.isFinite(format.width) && (format.width ?? 0) > 0 ? format.width : undefined;
  if (height !== undefined && width !== undefined) return Math.min(width, height);
  return height;
}

function normalizeDynamicRange(
  format: Pick<YtDlpFormatInfo, "dynamic_range" | "vcodec">,
): string | undefined {
  const raw = format.dynamic_range?.trim();
  if (raw) {
    const upper = raw.toUpperCase();
    if (upper === "SDR") return undefined;
    if (upper === "DV" || upper === "DOLBY VISION") return "Dolby Vision";
    return raw;
  }
  // Sparse metadata without `dynamic_range`: VP9 Profile 2 is 10-bit HDR on YouTube.
  if (format.vcodec && /^vp0?9\.0?2(?:\.|$)/i.test(format.vcodec)) {
    return "HDR";
  }
  return undefined;
}

function protocolRank(protocol: string | undefined): number {
  if (!protocol) return 1;
  const normalized = protocol.trim().toLowerCase();
  if (normalized === "https" || normalized === "http" || normalized === "http_dash_segments") {
    return 2;
  }
  if (isYoutubeHlsProtocol(normalized)) return 0;
  return 1;
}

function codecRank(codec: string | undefined): number {
  if (!codec || codec === "none") return 0;
  if (/^av0?1/i.test(codec)) return 4;
  if (/^vp0?9\.0?2(?:\.|$)/i.test(codec)) return 3;
  if (/^vp0?9/i.test(codec)) return 2;
  if (/^(hev|hvc)/i.test(codec)) return 2;
  if (/^avc/i.test(codec)) return 1;
  return 0;
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
): readonly YoutubeVideoQuality[] {
  const videoFormats = (formats ?? []).flatMap((format) => {
    const resolution = effectiveResolution(format);
    if (
      resolution === undefined ||
      !isJsonString(format.vcodec) ||
      format.vcodec === "none" ||
      !isJsonString(format.format_id) ||
      !/^[\w.-]+$/.test(format.format_id)
    ) {
      return [];
    }
    return [
      {
        format,
        formatId: format.format_id,
        resolution,
        dynamicRange: normalizeDynamicRange(format),
      },
    ];
  });
  // Rank like yt-dlp: short-side resolution → fps → HDR → direct HTTPS DASH
  // before HLS → modern codec (AV1 > VP9.2 > VP9/HEVC > H.264) → bitrate → id.
  // Sorting by raw `tbr` first caused HLS peak-bandwidth entries and bloated
  // H.264 streams to outrank faster HTTPS AV1/VP9 DASH streams.
  videoFormats.sort(
    (a, b) =>
      b.resolution - a.resolution ||
      (b.format.fps ?? 0) - (a.format.fps ?? 0) ||
      (b.dynamicRange ? 1 : 0) - (a.dynamicRange ? 1 : 0) ||
      protocolRank(b.format.protocol) - protocolRank(a.format.protocol) ||
      codecRank(b.format.vcodec) - codecRank(a.format.vcodec) ||
      (b.format.tbr ?? 0) - (a.format.tbr ?? 0) ||
      a.formatId.localeCompare(b.formatId),
  );
  const seen = new Set<string>();
  return videoFormats.flatMap(({ format, formatId, resolution, dynamicRange }) => {
    if (seen.has(formatId)) return [];
    seen.add(formatId);
    const fps =
      Number.isFinite(format.fps) && (format.fps ?? 0) > 0 ? `${format.fps}fps` : undefined;
    const bitrate =
      Number.isFinite(format.tbr) && (format.tbr ?? 0) > 0
        ? `${Number(((format.tbr ?? 0) / 1000).toFixed(2))} Mb/s`
        : undefined;
    const protocolTag = isYoutubeHlsProtocol(format.protocol) ? "HLS" : undefined;
    const base: YoutubeVideoQuality = {
      label: [
        `${resolution}p`,
        dynamicRange,
        codecLabel(format.vcodec),
        protocolTag,
        fps,
        bitrate,
        `#${formatId}`,
      ]
        .filter(Boolean)
        .join(" · "),
      rank: resolution,
      formatId,
      hasAudio: format.acodec ? format.acodec !== "none" : undefined,
    };
    if (dynamicRange && format.protocol) {
      return [{ ...base, dynamicRange, protocol: format.protocol }];
    }
    if (dynamicRange) return [{ ...base, dynamicRange }];
    if (format.protocol) return [{ ...base, protocol: format.protocol }];
    return [base];
  });
}
