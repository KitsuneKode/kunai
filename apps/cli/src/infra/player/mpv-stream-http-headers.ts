import {
  isLocalHlsManifestPlaybackUrl,
  isRemoteHlsManifestPlaybackUrl,
  isYoutubeWatchUrl,
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
  return {
    referer: typeof referer === "string" && referer.trim().length > 0 ? referer.trim() : undefined,
    userAgent:
      typeof userAgent === "string" && userAgent.trim().length > 0 ? userAgent.trim() : undefined,
    origin: typeof origin === "string" && origin.trim().length > 0 ? origin.trim() : undefined,
  };
}

export type PersistentLoadfileOptions = {
  readonly start: string;
  readonly referrer?: string;
  readonly "user-agent"?: string;
  readonly "http-header-fields"?: string;
  readonly "http-header-fields-clr"?: string;
  readonly ytdl?: string;
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

  if (isYoutubeWatchUrl(url) || ytdlOptions?.requiresYtdl) {
    loadOptions.ytdl = ytdlOptions?.ytdlFormat ?? "bv*+ba/b";
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
  },
): ["loadfile", string, "replace", -1, PersistentLoadfileOptions] {
  return [
    "loadfile",
    url,
    "replace",
    -1,
    buildPersistentLoadfileOptions(url, startAt, headers, ytdlOptions),
  ];
}
