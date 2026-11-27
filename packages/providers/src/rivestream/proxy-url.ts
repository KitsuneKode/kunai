import { blockedLiteralTargetReason } from "../shared/stream-reachability";

const RIVESTREAM_PROXY_HEADER_HOSTS = new Set(["proxy.valhallastream.com", "cors.corsflix.net"]);
const RIVESTREAM_PROXY_UNWRAP_HOSTS = new Set(["cors.corsflix.net"]);

function parseRivestreamProxyWrapperParams(
  sourceUrl: string,
  allowedHosts: ReadonlySet<string>,
): URLSearchParams | null {
  try {
    const url = new URL(sourceUrl);
    // Only observed wrappers may declare playback request headers or a direct
    // target. A query on any arbitrary media host is not authorization to
    // override either one.
    if (
      url.protocol !== "https:" ||
      !allowedHosts.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/m3u8"
    )
      return null;
    return url.searchParams;
  } catch {
    return null;
  }
}

/**
 * Unwrap a dead wrapper whose only purpose is to carry the real media URL and
 * playback headers. The target is still provider markup, so literal private or
 * non-HTTPS targets stay wrapped and the guarded stream probe remains the
 * boundary that decides reachability.
 */
export function unwrapRivestreamProxyUrl(sourceUrl: string): string {
  const params = parseRivestreamProxyWrapperParams(sourceUrl, RIVESTREAM_PROXY_UNWRAP_HOSTS);
  const raw = params?.get("url");
  if (!raw || raw.length > 4096) return sourceUrl;
  try {
    const target = new URL(raw);
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      blockedLiteralTargetReason(target.toString()) !== null
    ) {
      return sourceUrl;
    }
    return target.toString();
  } catch {
    return sourceUrl;
  }
}

export function parseRivestreamProxyHeaders(sourceUrl: string): Record<string, string> | null {
  const params = parseRivestreamProxyWrapperParams(sourceUrl, RIVESTREAM_PROXY_HEADER_HOSTS);
  if (!params) return null;
  const raw = params.get("headers");
  if (!raw || raw.length > 8192) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const key = name.toLowerCase();
    if (!["referer", "origin", "user-agent"].includes(key)) continue;
    // Reject, do not concatenate, injected header lines. Keep transport and
    // credential headers out of this untrusted query-string declaration.
    if (
      value.length > 2048 ||
      [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      continue;
    const cleaned = value.trim();
    if (!cleaned) continue;
    let value_ = cleaned;
    if (key === "referer" || key === "origin") {
      try {
        const target = new URL(cleaned);
        if (target.protocol !== "https:" || target.username || target.password) continue;
        // Send exactly what was validated: an Origin is scheme://host[:port].
        if (key === "origin") value_ = target.origin;
      } catch {
        continue;
      }
    }
    headers[key] = value_;
  }
  return Object.keys(headers).length > 0 ? headers : null;
}
