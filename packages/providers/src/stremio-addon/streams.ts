import { blockedLiteralTargetReason } from "@kunai/core";
import type { StreamCandidate } from "@kunai/types";

import { detectDynamicRangeFromLabel, qualityRankFromLabel } from "../shared/source-inventory";
import {
  readStreamSubtitles,
  stremioStreamSchema,
  toDisplayText,
  type StremioStream,
} from "./protocol";

/**
 * Why a stream an addon offered cannot be played by Kunai. Each one is counted
 * and reported; none is dropped without a trace.
 */
export type UnsupportedAddonStreamKind =
  /** `infoHash`: a torrent. Kunai has no torrent client. */
  | "torrent"
  /** `ytId`: a YouTube video id, which belongs to YouTube mode. */
  | "youtube"
  /** `externalUrl`: a web page to open, not a stream. */
  | "external-page"
  /** A `url` that is not http(s), such as `magnet:` or `rtmp:`. */
  | "unsupported-scheme"
  /** A `url` on a loopback, LAN or otherwise private host. */
  | "private-address"
  /** The entry failed validation or names no stream at all. */
  | "invalid";

export const UNSUPPORTED_ADDON_STREAM_LABELS: Readonly<Record<UnsupportedAddonStreamKind, string>> =
  {
    torrent: "torrent",
    youtube: "YouTube id",
    "external-page": "external page",
    "unsupported-scheme": "unsupported URL scheme",
    "private-address": "private address",
    invalid: "invalid entry",
  };

export interface PlayableAddonStream {
  readonly url: string;
  /** First line of the addon's `name`: the short label Stremio shows on the left. */
  readonly name?: string;
  /** The addon's `description` (or the older `title`), collapsed to one line. */
  readonly description?: string;
  readonly filename?: string;
  /** `behaviorHints.proxyHeaders.request`: sent on every request for this stream. */
  readonly headers?: Record<string, string>;
  /** `behaviorHints.notWebReady`: the URL may be plain HTTP or not an MP4. mpv plays both. */
  readonly notWebReady: boolean;
  /** `behaviorHints.bingeGroup`: streams sharing it are interchangeable across episodes. */
  readonly bingeGroup?: string;
  readonly videoSizeBytes?: number;
  readonly protocol: StreamCandidate["protocol"];
  readonly container: StreamCandidate["container"];
  readonly qualityLabel?: string;
  readonly qualityRank: number;
  readonly dynamicRange?: StreamCandidate["dynamicRange"];
  readonly subtitles: readonly { readonly url: string; readonly language?: string }[];
  /** Position in the addon's answer; addons list their preferred streams first. */
  readonly index: number;
}

export interface ClassifiedAddonStreams {
  readonly playable: readonly PlayableAddonStream[];
  readonly unsupported: Readonly<Partial<Record<UnsupportedAddonStreamKind, number>>>;
  readonly unsupportedTotal: number;
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// Framing and connection headers belong to the HTTP client, never to a source.
const FORBIDDEN_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
]);

/** C0 controls and DEL: never legal in a URL or a header value (CR/LF would split a header). */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Sort every entry of a stream list into "playable" or a named reason it is not.
 *
 * Playable means a direct http(s) URL on a public host. That says nothing about
 * whether the URL answers: `verifyCandidateStream` decides that afterwards.
 */
export function classifyAddonStreams(entries: readonly unknown[]): ClassifiedAddonStreams {
  const playable: PlayableAddonStream[] = [];
  const unsupported: Partial<Record<UnsupportedAddonStreamKind, number>> = {};
  let unsupportedTotal = 0;
  const reject = (kind: UnsupportedAddonStreamKind) => {
    unsupported[kind] = (unsupported[kind] ?? 0) + 1;
    unsupportedTotal += 1;
  };
  const seenUrls = new Set<string>();

  entries.forEach((entry, index) => {
    const parsed = stremioStreamSchema.safeParse(entry);
    if (!parsed.success) return reject("invalid");
    const stream = parsed.data;

    const url = stream.url?.trim();
    if (!url) {
      if (stream.infoHash) return reject("torrent");
      if (stream.ytId) return reject("youtube");
      if (stream.externalUrl) return reject("external-page");
      return reject("invalid");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reject("invalid");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return reject("unsupported-scheme");
    }
    if (parsedUrl.username || parsedUrl.password || hasControlCharacter(url)) {
      return reject("invalid");
    }
    if (blockedLiteralTargetReason(url) !== null) return reject("private-address");

    const headers = readRequestHeaders(stream);
    if (headers === null) return reject("invalid");
    // One URL listed twice is one stream; the first listing keeps its position.
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    const name = firstLine(stream.name);
    const description = oneLine(stream.description ?? stream.title);
    const filename = oneLine(stream.behaviorHints?.filename);
    const labelText = [name, description, filename].filter(Boolean).join(" ");
    const quality = readQuality(labelText);
    const { protocol, container } = inferProtocol(parsedUrl, stream, filename);

    playable.push({
      url,
      ...(name ? { name } : null),
      ...(description ? { description } : null),
      ...(filename ? { filename } : null),
      ...(headers ? { headers } : null),
      notWebReady: stream.behaviorHints?.notWebReady === true,
      ...(stream.behaviorHints?.bingeGroup
        ? { bingeGroup: stream.behaviorHints.bingeGroup }
        : null),
      ...(typeof stream.behaviorHints?.videoSize === "number"
        ? { videoSizeBytes: stream.behaviorHints.videoSize }
        : null),
      protocol,
      container,
      ...(quality ? { qualityLabel: quality.label } : null),
      qualityRank: quality?.rank ?? 0,
      dynamicRange: detectDynamicRangeFromLabel(labelText),
      subtitles: readStreamSubtitles(stream)
        .filter((subtitle) => isPublicHttpUrl(subtitle.url))
        .map((subtitle) => ({
          url: subtitle.url,
          ...(subtitle.lang ? { language: subtitle.lang } : null),
        })),
      index,
    });
  });

  return { playable, unsupported, unsupportedTotal };
}

/** "3 torrent, 1 external page" — for failure messages, traces and diagnostics. */
export function describeUnsupportedAddonStreams(
  unsupported: ClassifiedAddonStreams["unsupported"],
): string {
  return Object.entries(unsupported)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(
      ([kind, count]) =>
        `${count} ${UNSUPPORTED_ADDON_STREAM_LABELS[kind as UnsupportedAddonStreamKind]}`,
    )
    .join(", ");
}

/**
 * `proxyHeaders.request` as the headers to send, `undefined` when there are
 * none, or `null` when a header cannot be sent safely. A stream that needs a
 * header Kunai cannot send would fail at the CDN anyway, so it is refused
 * rather than shipped without it.
 */
function readRequestHeaders(stream: StremioStream): Record<string, string> | undefined | null {
  const request = stream.behaviorHints?.proxyHeaders?.request;
  if (!request) return undefined;
  const headers: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(request)) {
    const name = rawName.trim();
    if (!HEADER_NAME.test(name) || hasControlCharacter(value)) return null;
    if (FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function isPublicHttpUrl(url: string): boolean {
  return blockedLiteralTargetReason(url) === null;
}

function firstLine(value: string | null | undefined): string | undefined {
  return toDisplayText(value?.split(/\r?\n/, 1)[0]);
}

function oneLine(value: string | null | undefined): string | undefined {
  return toDisplayText(value);
}

/**
 * Resolution from the addon's own text. Addons write it as `2160p`, `1080p` or
 * `4K`; a bare number such as a year or a file size is never read as one.
 */
function readQuality(text: string): { readonly label: string; readonly rank: number } | undefined {
  const explicit = text.match(/\b(2160|1440|1080|720|576|540|480|360|240)\s*[pi]\b/i)?.[1];
  const label = explicit ? `${explicit}p` : /\b(?:4k|uhd)\b/i.test(text) ? "2160p" : undefined;
  if (!label) return undefined;
  const rank = qualityRankFromLabel(label);
  return rank ? { label, rank } : undefined;
}

function inferProtocol(
  url: URL,
  stream: StremioStream,
  filename: string | undefined,
): Pick<StreamCandidate, "protocol" | "container"> {
  const contentType = readHeader(
    stream.behaviorHints?.proxyHeaders?.response,
    "content-type",
  )?.toLowerCase();
  if (contentType?.includes("mpegurl")) return { protocol: "hls", container: "m3u8" };
  if (contentType?.includes("dash+xml")) return { protocol: "dash", container: "mpd" };

  const path = url.pathname.toLowerCase();
  if (path.endsWith(".m3u8")) return { protocol: "hls", container: "m3u8" };
  if (path.endsWith(".mpd")) return { protocol: "dash", container: "mpd" };

  const file = `${path} ${filename?.toLowerCase() ?? ""}`;
  if (contentType?.includes("video/mp4") || /\.(?:mp4|m4v)(?:\s|$)/.test(file)) {
    return { protocol: "mp4", container: "mp4" };
  }
  if (contentType?.includes("video/webm") || /\.webm(?:\s|$)/.test(file)) {
    return { protocol: "unknown", container: "webm" };
  }
  // Extensionless or MKV. mpv detects the format from the bytes.
  return { protocol: "unknown", container: "unknown" };
}

function readHeader(
  headers: Record<string, string> | null | undefined,
  wanted: string,
): string | undefined {
  if (!headers) return undefined;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === wanted) return value;
  }
  return undefined;
}
