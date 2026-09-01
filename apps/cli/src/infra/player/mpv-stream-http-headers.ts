import {
  isAllowedMpvUrl,
  isLocalHlsManifestPlaybackUrl,
  isRemoteHlsManifestPlaybackUrl,
  isYoutubeWatchUrl,
  type MpvUrlKind,
} from "./mpv-playback-url";
import { shouldApplyStartAtSeek } from "./mpv-start-seek";

/**
 * Last-resort selector when a caller hands us no format. Must stay equal to the
 * provider's `defaultYtdlPlaybackFormat()` — importing it here would pull the whole
 * provider barrel into the launcher bundle, so a test asserts the two agree instead.
 */
export const DEFAULT_MPV_YTDL_FORMAT = "bv*+ba/b";

export const LOCAL_HLS_DEMUXER_LAVF_OPTIONS =
  "protocol_whitelist=[file,tcp,tls,https,http,crypto,data]";

export type NormalizedStreamHttpHeaders = {
  readonly referer?: string;
  readonly userAgent?: string;
  readonly origin?: string;
  /**
   * Every other header the provider attached, already formatted as
   * `Name: Value` for mpv's `http-header-fields` list.
   *
   * mpv has dedicated options for referer and user-agent and nothing else, so
   * anything a provider adds beyond those has to ride this list or it is simply
   * dropped. VidLink is why this exists: its DASH manifests are CloudFront
   * signed and answer 403 without their `Cookie`, so a resolve that carried the
   * cookie still failed at the player.
   */
  readonly extraFields: readonly string[];
};

/** Headers mpv sets through dedicated options rather than the header list. */
const DEDICATED_HEADER_NAMES = new Set(["referer", "user-agent", "origin"]);

/** Canonical HTTP header fields used for mpv launch args and persistent loadfile options. */
export function normalizeStreamHttpHeaders(
  headers: Record<string, string> | undefined,
): NormalizedStreamHttpHeaders {
  const source = headers ?? {};
  const referer = source.referer ?? source.Referer;
  const userAgent = source["user-agent"] ?? source["User-Agent"];
  const origin = source.origin ?? source.Origin;
  const sanitize = (value: unknown, pattern: RegExp): string | undefined => {
    if (typeof value !== "string") return undefined;
    const sanitized = value.trim().replace(pattern, "");
    return sanitized.length > 0 ? sanitized : undefined;
  };
  const extraFields: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (DEDICATED_HEADER_NAMES.has(name.toLowerCase())) continue;
    const cleaned = sanitize(value, /[\r\n]/g);
    if (!cleaned) continue;
    // mpv separates this list on commas and offers no escape, so a value
    // containing one cannot be represented. Dropping the header is honest;
    // stripping the comma would corrupt a signature or cookie silently.
    if (cleaned.includes(",")) continue;
    extraFields.push(`${name}: ${cleaned}`);
  }

  return {
    referer: sanitize(referer, /[\r\n]/g),
    userAgent: sanitize(userAgent, /[\r\n]/g),
    origin: sanitize(origin, /[\r\n,]/g),
    extraFields,
  };
}

/** ani-cli parity exception for the real mp4upload HTTPS stream host only. */
export function shouldDisableMpvTlsVerify(
  url: string,
  _headers: Record<string, string> | undefined,
): boolean {
  // WHATWG parsing strips controls and repairs a missing slash before exposing the hostname.
  for (const character of url) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "mp4upload.com") return true;
    if (!hostname.endsWith(".mp4upload.com")) return false;
    return hostname.split(".").every((label) => label.length > 0);
  } catch {
    return false;
  }
}

export type PersistentLoadfileOptions = {
  readonly start: string;
  readonly aid?: string;
  readonly referrer?: string;
  readonly "user-agent"?: string;
  readonly "http-header-fields"?: string;
  readonly "http-header-fields-clr"?: string;
  readonly "tls-verify"?: string;
  /** mpv's `--ytdl` is a yes/no flag: whether ytdl_hook runs at all. */
  readonly ytdl?: string;
  /** mpv's `--ytdl-format` is the format selector string. */
  readonly "ytdl-format"?: string;
  readonly "ytdl-raw-options"?: string;
  readonly "demuxer-lavf-o"?: string;
  readonly "demuxer-lavf-o-clr"?: string;
  /** Live-broadcast demuxer profile; see {@link LIVE_DEMUXER_OPTIONS}. */
  readonly "cache-pause-wait"?: string;
  readonly "demuxer-readahead-secs"?: string;
  readonly "demuxer-max-bytes"?: string;
};

/**
 * Demuxer profile for an active broadcast: a small readahead window so playback
 * stays near the live edge, and a shorter reconnect ladder because a dropped live
 * segment is never coming back. Shared with `buildMpvArgs` so a live stream loaded
 * into an *existing* persistent session gets the same treatment as one that the
 * process was spawned on — a loadfile replacement inherits nothing from spawn args.
 */
export const LIVE_DEMUXER_OPTIONS = {
  "cache-pause-wait": "1",
  "demuxer-readahead-secs": "10",
  "demuxer-max-bytes": "32MiB",
} as const;

/**
 * The live half of `demuxer-lavf-o`, kept apart from {@link LIVE_DEMUXER_OPTIONS}
 * because that option is single-valued: setting it twice does not merge, the last
 * write wins. A live stream served from a materialized local HLS manifest needs
 * both the reconnect ladder and the protocol whitelist, so callers compose the
 * parts through {@link composeDemuxerLavfOptions} and set the option exactly once.
 */
export const LIVE_DEMUXER_LAVF_OPTIONS =
  "reconnect=1,reconnect_streamed=1,reconnect_on_network_error=1,reconnect_delay_max=3,reconnect_max_retries=5";

/**
 * Join `demuxer-lavf-o` fragments into one value. The protocol whitelist is placed
 * last by callers because its `[a,b,c]` bracket group is what protects its own
 * commas from the surrounding key=value list.
 */
export function composeDemuxerLavfOptions(
  ...parts: readonly (string | undefined)[]
): string | undefined {
  const present = parts.filter((part): part is string => Boolean(part?.trim()));
  return present.length > 0 ? present.join(",") : undefined;
}

export function buildPersistentLoadfileOptions(
  url: string,
  startAt: number | undefined,
  headers: Record<string, string> | undefined,
  ytdlOptions?: {
    readonly requiresYtdl?: boolean;
    readonly ytdlFormat?: string;
    readonly ytdlRawOptions?: string;
    readonly isLive?: boolean;
    readonly urlKind?: MpvUrlKind;
    readonly videoOnly?: boolean;
  },
): PersistentLoadfileOptions {
  const { referer, userAgent, origin, extraFields } = normalizeStreamHttpHeaders(headers);
  const loadOptions: Record<string, string> = {
    start: !ytdlOptions?.isLive && shouldApplyStartAtSeek(startAt) ? String(startAt) : "0",
  };
  if (typeof ytdlOptions?.videoOnly === "boolean") {
    loadOptions.aid = ytdlOptions.videoOnly ? "no" : "auto";
  }

  if (referer) {
    loadOptions.referrer = referer;
  }
  if (userAgent) {
    loadOptions["user-agent"] = userAgent;
  }
  const headerFields = [...(origin ? [`Origin: ${origin}`] : []), ...extraFields];
  if (headerFields.length > 0) {
    loadOptions["http-header-fields"] = headerFields.join(",");
  } else {
    loadOptions["http-header-fields-clr"] = "";
  }
  if (shouldDisableMpvTlsVerify(url, headers)) {
    loadOptions["tls-verify"] = "no";
  }

  if (isYoutubeWatchUrl(url) || ytdlOptions?.requiresYtdl) {
    // `ytdl` is a yes/no flag and `ytdl-format` is the selector, so assigning
    // the format to `ytdl` silently discarded the user's quality ceiling on the
    // persistent session: a loadfile carrying a `height<=144` selector still
    // played 720p. Probing the live IPC socket on mpv 0.41,
    // `set_property ytdl "bv*+ba/b"` answers `unsupported format for accessing
    // property` while `ytdl-format` accepts it. Setting the flag explicitly
    // also survives a user config that turned ytdl off.
    loadOptions.ytdl = "yes";
    loadOptions["ytdl-format"] = ytdlOptions?.ytdlFormat ?? DEFAULT_MPV_YTDL_FORMAT;
    if (ytdlOptions?.ytdlRawOptions?.trim()) {
      loadOptions["ytdl-raw-options"] = ytdlOptions.ytdlRawOptions.trim();
    }
  } else if (isRemoteHlsManifestPlaybackUrl(url)) {
    loadOptions.ytdl = "no";
  }
  const demuxerLavfOptions = composeDemuxerLavfOptions(
    ytdlOptions?.isLive ? LIVE_DEMUXER_LAVF_OPTIONS : undefined,
    isLocalHlsManifestPlaybackUrl(url) ? LOCAL_HLS_DEMUXER_LAVF_OPTIONS : undefined,
  );
  if (demuxerLavfOptions) {
    loadOptions["demuxer-lavf-o"] = demuxerLavfOptions;
  } else if (/^https?:\/\//i.test(url.trim())) {
    loadOptions["demuxer-lavf-o-clr"] = "";
  }

  if (ytdlOptions?.isLive) {
    Object.assign(loadOptions, LIVE_DEMUXER_OPTIONS);
  }

  return loadOptions as PersistentLoadfileOptions;
}

export function buildPersistentLoadfileCommand(
  url: string,
  startAt?: number,
  headers?: Record<string, string>,
  ytdlOptions?: {
    readonly requiresYtdl?: boolean;
    readonly ytdlFormat?: string;
    readonly ytdlRawOptions?: string;
    readonly isLive?: boolean;
    readonly urlKind?: MpvUrlKind;
    readonly videoOnly?: boolean;
  },
): ["loadfile", string, "replace", -1, PersistentLoadfileOptions] {
  if (!isAllowedMpvUrl(url, ytdlOptions?.urlKind ?? "remote")) {
    throw new Error("Refusing to load unsafe stream URL scheme in mpv");
  }
  return [
    "loadfile",
    url,
    "replace",
    -1,
    buildPersistentLoadfileOptions(url, startAt, headers, ytdlOptions),
  ];
}
