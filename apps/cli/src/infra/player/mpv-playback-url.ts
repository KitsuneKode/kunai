import { blockedLiteralTargetReason } from "@kunai/types";

export type MpvUrlKind = "remote" | "local";

/**
 * Restricts provider-controlled media targets to HTTP(S); trusted local
 * surfaces may use files. Any HTTP(S) URL — remote OR local-kind — refuses
 * private literal hosts: a provider-supplied stream/trailer URL must not make
 * mpv (or a spawn of it) reach the LAN, since mpv fetches the URL itself. The
 * local kind only widens the scheme set to files; it is not a network-target
 * exemption.
 */
export function isAllowedMpvUrl(url: string, kind: MpvUrlKind): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("-")) return false;
  if (/^https?:\/\//i.test(trimmed)) {
    return blockedLiteralTargetReason(trimmed) === null;
  }
  if (kind !== "local") return false;
  if (/^file:\/\//i.test(trimmed)) return true;
  return !trimmed.includes("://");
}

/**
 * Headers mpv attaches to every request it makes — including subtitle fetches.
 * When the stream's header set carries credentials, a provider-controlled
 * subtitle URL on another host exfiltrates them.
 */
const CREDENTIAL_HEADER_NAMES = new Set(["authorization", "cookie", "proxy-authorization"]);

function hasCredentialHeaders(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  return Object.keys(headers).some((name) => CREDENTIAL_HEADER_NAMES.has(name.toLowerCase()));
}

/**
 * The stream a subtitle URL travels with — the session's own `StreamInfo`,
 * never a provider-supplied field. `headers` are what mpv will attach to the
 * subtitle fetch, so they decide whether cross-origin subs leak credentials.
 */
export type SubtitleStreamContext = {
  readonly url: string;
  readonly headers?: Record<string, string>;
};

/**
 * The subtitle variant of {@link isAllowedMpvUrl}: subtitles reach mpv as
 * provider-controlled URLs that mpv fetches itself, so on top of the scheme
 * gate they must not name private/loopback targets, and they must not ride a
 * credentialed header set to a different origin than the stream.
 *
 * DNS is deliberately not resolved here — mpv resolves independently at fetch
 * time, so an app-side lookup would be a TOCTOU no-op. Literal checks are the
 * enforceable boundary.
 */
export function isAllowedSubtitleTarget(
  url: string,
  kind: MpvUrlKind,
  stream?: SubtitleStreamContext,
): boolean {
  if (!isAllowedMpvUrl(url, kind)) return false;
  if (kind !== "remote") return true;
  if (blockedLiteralTargetReason(url) !== null) return false;
  if (!stream || !hasCredentialHeaders(stream.headers)) return true;
  try {
    return new URL(url).origin === new URL(stream.url).origin;
  } catch {
    return false;
  }
}

/** Remote HTTP(S) HLS manifest URL. */
export function isRemoteHlsManifestPlaybackUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) && /\.m3u8(?:[?#]|$)/i.test(trimmed);
}

/** Local `.m3u8` paths produced by the HLS manifest materializer (not remote URLs). */
export function isLocalHlsManifestPlaybackUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return false;
  return /\.m3u8(?:[?#]|$)/i.test(trimmed);
}

export function isYoutubeWatchUrl(url: string): boolean {
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/live\/|youtube\.com\/shorts\/)/i.test(
    url.trim(),
  );
}
