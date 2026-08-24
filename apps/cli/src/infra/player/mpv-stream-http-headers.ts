import {
  isAllowedMpvUrl,
  isLocalHlsManifestPlaybackUrl,
  isRemoteHlsManifestPlaybackUrl,
  isYoutubeWatchUrl,
  type MpvUrlKind,
} from "./mpv-playback-url";
import { shouldApplyStartAtSeek } from "./mpv-start-seek";

export const LOCAL_HLS_DEMUXER_LAVF_OPTIONS =
  "protocol_whitelist=[file,tcp,tls,https,http,crypto,data]";

export type NormalizedStreamHttpHeaders = {
  readonly referer?: string;
  readonly userAgent?: string;
  readonly origin?: string;
};

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
  return {
    referer: sanitize(referer, /[\r\n]/g),
    userAgent: sanitize(userAgent, /[\r\n]/g),
    origin: sanitize(origin, /[\r\n,]/g),
  };
}

/**
 * ani-cli plays mp4upload with `--tls-verify=no`. Detect by stream URL or Referer.
 */
export function shouldDisableMpvTlsVerify(
  url: string,
  headers: Record<string, string> | undefined,
): boolean {
  if (/mp4upload\.com/i.test(url)) return true;
  const { referer } = normalizeStreamHttpHeaders(headers);
  return Boolean(referer && /mp4upload\.com/i.test(referer));
}

export type PersistentLoadfileOptions = {
  readonly start: string;
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
};

export function buildPersistentLoadfileOptions(
  url: string,
  startAt: number | undefined,
  headers: Record<string, string> | undefined,
  ytdlOptions?: {
    readonly requiresYtdl?: boolean;
    readonly ytdlFormat?: string;
    readonly ytdlRawOptions?: string;
    readonly urlKind?: MpvUrlKind;
  },
): PersistentLoadfileOptions {
  const { referer, userAgent, origin } = normalizeStreamHttpHeaders(headers);
  const loadOptions: Record<string, string> = {
    start: shouldApplyStartAtSeek(startAt) ? String(startAt) : "0",
  };

  if (referer) {
    loadOptions.referrer = referer;
  }
  if (userAgent) {
    loadOptions["user-agent"] = userAgent;
  }
  if (origin) {
    loadOptions["http-header-fields"] = `Origin: ${origin}`;
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
    loadOptions["ytdl-format"] = ytdlOptions?.ytdlFormat ?? "bv*+ba/b";
    if (ytdlOptions?.ytdlRawOptions?.trim()) {
      loadOptions["ytdl-raw-options"] = ytdlOptions.ytdlRawOptions.trim();
    }
  } else if (isRemoteHlsManifestPlaybackUrl(url)) {
    loadOptions.ytdl = "no";
  }
  if (isLocalHlsManifestPlaybackUrl(url)) {
    loadOptions["demuxer-lavf-o"] = LOCAL_HLS_DEMUXER_LAVF_OPTIONS;
  } else if (/^https?:\/\//i.test(url.trim())) {
    loadOptions["demuxer-lavf-o-clr"] = "";
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
    readonly urlKind?: MpvUrlKind;
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
