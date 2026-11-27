import {
  createDeadlineSignal,
  fetchProbeTarget,
  isGuardedPlatformFetch,
  type StreamReachabilityFetch,
} from "@kunai/core";

import { MAX_PROBE_BODY_BYTES, readBoundedTextBody } from "./bounded-text-body";
import {
  HLS_SEGMENT_PROBE_MIN_BYTES,
  isHlsMasterPlaylist,
  isHlsPlaylistUrl,
  parseFirstHlsMediaSegmentPath,
  parseFirstHlsVariantPath,
  resolveHlsSegmentUrl,
} from "./hls-manifest";
import { isDefinitiveHttpStatus, isDefinitiveNetworkError } from "./refusal-classification";
import {
  hasFragmentedMp4Prefix,
  hasImageContainerMagic,
  hasTransportStreamSync,
  hasTransportStreamSyncAnywhere,
  isHlsContentType,
  readIsoBox,
} from "./segment-evidence";

// The fetch-guard chain lives in @kunai/core so other runtimes (the Android
// stream gateway under infra/player) can share the DNS/private-address rules
// without importing a provider package. These re-exports keep the module's
// public surface unchanged.
export {
  blockedLiteralTargetReason,
  fetchGuardedStreamTarget,
  isGuardedPlatformFetch,
} from "@kunai/core";
export type { ProbeFetchOutcome, StreamReachabilityFetch } from "@kunai/core";

export type StreamReachabilityProbeResult =
  | { readonly status: "reachable"; readonly contentType?: string }
  | {
      readonly status: "unreachable";
      readonly reason: string;
      readonly definitive: boolean;
      /**
       * Transport and target-guard failures indict the host; HTTP, manifest,
       * and media evidence indict only the URL that was probed.
       */
      readonly refusalScope?: "host" | "url";
      /** The host whose transport or guard actually failed, when known. */
      readonly refusalHost?: string;
    }
  | { readonly status: "timeout" };

export type ProbeStreamReachabilityInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamReachabilityFetch;
  /**
   * Per-target answer to "does this fetch resolve the hostname here?" — a
   * relay port resolves on the relay's side for upstreams it forwards, so
   * local DNS validation is meaningless for those URLs but still required
   * for everything it serves directly. Absent, injected fetches are treated
   * as remote-resolving and the real `fetch` as local.
   */
  readonly resolvesLocally?: (url: string) => boolean;
  /**
   * Strict mode for addon streams (beta): refuse playlists, redirects and
   * anything that is not positive direct-media evidence in a bounded prefix —
   * a `reachable` verdict then means one self-contained file was confirmed.
   */
  readonly requireDirectMedia?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const FMP4_PROBE_PREFIX_BYTES = 64 * 1024;
const SEGMENT_RANGE_HEADER = `bytes=0-${FMP4_PROBE_PREFIX_BYTES - 1}`;
// A body read past this after the prefix is already gathered is a server
// ignoring Range and dumping the whole segment on us — cap the bleed.

/** Capture a bounded prefix; stop early once positive media evidence is sufficient. */
async function readPrefixBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  acceptPrefix?: (prefix: Uint8Array) => boolean,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const prefix = new Uint8Array(Math.min(maxBytes, MAX_PROBE_BODY_BYTES));
  let seen = 0;
  let nextCheck = HLS_SEGMENT_PROBE_MIN_BYTES;
  try {
    while (seen < prefix.byteLength) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const count = Math.min(value.byteLength, prefix.byteLength - seen);
        prefix.set(value.subarray(0, count), seen);
        seen += count;
        if (acceptPrefix && seen >= nextCheck) {
          if (acceptPrefix(prefix.subarray(0, seen))) break;
          // Bound structural rechecks even when the server trickles tiny chunks.
          nextCheck = seen + HLS_SEGMENT_PROBE_MIN_BYTES;
        }
      }
    }
    await reader.cancel("probe-satisfied").catch(() => {});
    return prefix.subarray(0, seen);
  } catch (error) {
    // Preserve abort/network classification rather than reporting a short body.
    await reader.cancel("probe-failed").catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Quick manifest/segment probe used before accepting a provider candidate or handing off to mpv. */
export async function probeStreamReachability(
  input: ProbeStreamReachabilityInput,
): Promise<StreamReachabilityProbeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(100, deadline - Date.now());
  const headers = input.headers ?? {};
  // Injected fetches own their destinations; real fetches get DNS answers
  // re-validated so a public name cannot resolve to a private address.
  // Compare against the captured platform fetch, not `input.fetchImpl ===
  // undefined`: defaulting to a stubbed `globalThis.fetch` used to keep DNS
  // on and treat documentation hosts as blocked-target.
  const resolveNamesFor = input.resolvesLocally ?? (() => isGuardedPlatformFetch(fetchImpl));

  if (input.requireDirectMedia) {
    return probeDirectMedia(input, fetchImpl, resolveNamesFor);
  }

  if (isHlsPlaylistUrl(input.url)) {
    return probeHlsManifest(
      fetchImpl,
      input.url,
      headers,
      remaining,
      input.signal,
      resolveNamesFor,
    );
  }

  try {
    const head = await probeHttpStatus(fetchImpl, input.url, {
      method: "HEAD",
      headers,
      remainingMs: remaining,
      parentSignal: input.signal,
      resolveNamesFor,
    });
    if (head.status === "reachable") {
      if (isHlsContentType(head.contentType)) {
        return probeHlsManifest(
          fetchImpl,
          input.url,
          headers,
          remaining,
          input.signal,
          resolveNamesFor,
        );
      }
      return head;
    }
    if (head.status === "timeout") return head;
    if (head.status === "unreachable" && head.definitive) return head;
  } catch {
    if (Date.now() >= deadline) return { status: "timeout" };
  }

  if (Date.now() >= deadline) return { status: "timeout" };

  const get = await probeHttpStatus(fetchImpl, input.url, {
    method: "GET",
    headers: { ...headers, Range: "bytes=0-0" },
    remainingMs: remaining,
    parentSignal: input.signal,
    resolveNamesFor,
    healthyStatus: (status) => (status >= 200 && status < 300) || status === 206,
  });
  if (get.status === "reachable" && isHlsContentType(get.contentType)) {
    return probeHlsManifest(
      fetchImpl,
      input.url,
      headers,
      remaining,
      input.signal,
      resolveNamesFor,
    );
  }
  return get;
}

/** Provider resolve gates allow slow CDNs through as unverified; only definitive failures block. */
export function isStreamReachableForResolve(probe: StreamReachabilityProbeResult): boolean {
  if (probe.status === "reachable" || probe.status === "timeout") {
    return true;
  }
  return probe.status === "unreachable" && !probe.definitive;
}

export function isStreamReachabilityVerified(probe: StreamReachabilityProbeResult): boolean {
  return probe.status === "reachable";
}

/** mpv handoff keeps legacy leniency: inconclusive probes should not block playback. */
export function isStreamReachableForPlaybackPreflight(
  probe: StreamReachabilityProbeResult,
): boolean {
  return probe.status === "reachable" || probe.status === "timeout";
}

export function shouldAbortPlaybackForPreflight(
  probe: StreamReachabilityProbeResult,
  ipcConnected: boolean,
): boolean {
  return probe.status === "unreachable" && probe.definitive && !ipcConnected;
}

export function isHlsManifestUrl(url: string): boolean {
  return isHlsPlaylistUrl(url);
}

async function probeHlsManifest(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  headers: Record<string, string>,
  remaining: () => number,
  parentSignal: AbortSignal | undefined,
  resolveNamesFor: (url: string) => boolean,
): Promise<StreamReachabilityProbeResult> {
  if (parentSignal?.aborted || remaining() <= 0) {
    return { status: "timeout" };
  }

  const master = await fetchPlaylistText(
    fetchImpl,
    url,
    headers,
    remaining,
    parentSignal,
    resolveNamesFor,
  );
  if (master.status !== "ok") {
    return master.result;
  }

  let mediaPlaylistUrl = master.finalUrl;
  let mediaPlaylistText = master.text;

  if (isHlsMasterPlaylist(master.text)) {
    const variantPath = parseFirstHlsVariantPath(master.text);
    if (!variantPath) {
      return {
        status: "unreachable",
        reason: "HLS master playlist has no variant URI",
        definitive: true,
      };
    }
    // A playlist can name an absolute URI — the target check inside
    // fetchPlaylistText is what keeps it pointing somewhere public.
    // Relative variant URIs resolve against the redirected master URL, not the
    // initial URL before redirects.
    mediaPlaylistUrl = resolveHlsSegmentUrl(master.finalUrl, variantPath);
    if (parentSignal?.aborted || remaining() <= 0) {
      return { status: "timeout" };
    }
    const variant = await fetchPlaylistText(
      fetchImpl,
      mediaPlaylistUrl,
      headers,
      remaining,
      parentSignal,
      resolveNamesFor,
    );
    if (variant.status !== "ok") {
      return variant.result;
    }
    mediaPlaylistUrl = variant.finalUrl;
    mediaPlaylistText = variant.text;
  }

  const segmentPath = parseFirstHlsMediaSegmentPath(mediaPlaylistText);
  if (!segmentPath) {
    // Empty media playlist with no URI lines — treat as inconclusive rather than healthy.
    return {
      status: "unreachable",
      reason: "HLS media playlist has no segment URI",
      definitive: true,
    };
  }

  const segmentUrl = resolveHlsSegmentUrl(mediaPlaylistUrl, segmentPath);
  return probeHlsMediaSegment(
    fetchImpl,
    segmentUrl,
    headers,
    remaining,
    parentSignal,
    resolveNamesFor,
  );
}

async function fetchPlaylistText(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  headers: Record<string, string>,
  remaining: () => number,
  parentSignal: AbortSignal | undefined,
  resolveNamesFor: (url: string) => boolean,
): Promise<
  | { readonly status: "ok"; readonly text: string; readonly finalUrl: string }
  | { readonly status: "fail"; readonly result: StreamReachabilityProbeResult }
> {
  if (parentSignal?.aborted || remaining() <= 0) {
    return { status: "fail", result: { status: "timeout" } };
  }

  const deadline = createDeadlineSignal(parentSignal, remaining());

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url,
      init: { method: "GET", headers, signal: deadline.signal },
      remaining,
      parentSignal,
      resolveNamesFor,
    });
    if (outcome.kind === "timeout") {
      return { status: "fail", result: { status: "timeout" } };
    }
    if (outcome.kind === "blocked") {
      return {
        status: "fail",
        result: hostUnreachable(`blocked stream target: ${outcome.reason}`, true, outcome.url),
      };
    }
    const response = outcome.response;
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      const definitive = isDefinitiveHttpStatus(response.status);
      return {
        status: "fail",
        result: { status: "unreachable", reason: `HTTP ${response.status}`, definitive },
      };
    }
    const text = await readBoundedTextBody(response.body);
    if (text === null) {
      return {
        status: "fail",
        result: {
          status: "unreachable",
          reason: "playlist body empty or above probe cap",
          definitive: true,
        },
      };
    }
    return { status: "ok", text, finalUrl: outcome.finalUrl };
  } catch (error) {
    if (deadline.signal.aborted || parentSignal?.aborted) {
      return { status: "fail", result: { status: "timeout" } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "fail",
      result: hostUnreachable(message, isDefinitiveNetworkError(message), url),
    };
  } finally {
    deadline.release();
  }
}

async function probeHlsMediaSegment(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  headers: Record<string, string>,
  remaining: () => number,
  parentSignal: AbortSignal | undefined,
  resolveNamesFor: (url: string) => boolean,
): Promise<StreamReachabilityProbeResult> {
  if (parentSignal?.aborted || remaining() <= 0) {
    return { status: "timeout" };
  }

  const deadline = createDeadlineSignal(parentSignal, remaining());

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url,
      init: {
        method: "GET",
        headers: { ...headers, Range: SEGMENT_RANGE_HEADER },
        signal: deadline.signal,
      },
      remaining,
      parentSignal,
      resolveNamesFor,
    });
    if (outcome.kind === "timeout") return { status: "timeout" };
    if (outcome.kind === "blocked") {
      return hostUnreachable(`HLS segment blocked: ${outcome.reason}`, true, outcome.url);
    }
    const response = outcome.response;
    const healthyStatus = (status: number) => (status >= 200 && status < 300) || status === 206;
    if (!healthyStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const definitive = isDefinitiveHttpStatus(response.status);
      return {
        status: "unreachable",
        reason: `HLS segment unreachable: HTTP ${response.status}`,
        definitive,
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const htmlLabeled = contentType.includes("text/html");
    // Image-labelled segments are either decoys or TS behind a disguise; read
    // far enough to tell, stopping as soon as media evidence appears.
    const imageLabeled = contentType.startsWith("image/");
    const firstBytes = await readPrefixBytes(
      response.body,
      htmlLabeled || imageLabeled ? FMP4_PROBE_PREFIX_BYTES : HLS_SEGMENT_PROBE_MIN_BYTES,
      htmlLabeled
        ? (prefix) => hasTransportStreamSync(prefix) || hasFragmentedMp4Prefix(prefix)
        : imageLabeled
          ? (prefix) => hasTransportStreamSyncAnywhere(prefix) || hasFragmentedMp4Prefix(prefix)
          : undefined,
    );
    // Some media CDNs mislabel TS/fMP4 as HTML. Only positive media evidence may
    // override that refusal; HTML, short bodies and ambiguous text still fail.
    if (htmlLabeled && !hasTransportStreamSync(firstBytes) && !hasFragmentedMp4Prefix(firstBytes)) {
      return {
        status: "unreachable",
        reason: "HLS segment unreachable: content-type text/html",
        definitive: true,
      };
    }
    // An image container with no media evidence is a definitive decoy. The
    // media checks run first because the inverse disguise is real: working
    // lanes serve TS bytes mislabeled image/jpeg, and those must still pass.
    if (
      hasImageContainerMagic(firstBytes) &&
      !hasTransportStreamSyncAnywhere(firstBytes) &&
      !hasFragmentedMp4Prefix(firstBytes)
    ) {
      return {
        status: "unreachable",
        reason: "HLS segment unreachable: image-container decoy, not media",
        definitive: true,
      };
    }

    if (firstBytes.byteLength < HLS_SEGMENT_PROBE_MIN_BYTES) {
      return {
        status: "unreachable",
        reason: `HLS segment unreachable: body too small (${firstBytes.byteLength}B)`,
        definitive: true,
      };
    }

    return { status: "reachable" };
  } catch (error) {
    if (deadline.signal.aborted || parentSignal?.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return hostUnreachable(
      `HLS segment unreachable: ${message}`,
      isDefinitiveNetworkError(message),
      url,
    );
  } finally {
    deadline.release();
  }
}

async function probeHttpStatus(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  options: {
    readonly method: "HEAD" | "GET";
    readonly headers: Record<string, string>;
    readonly remainingMs: () => number;
    readonly parentSignal?: AbortSignal;
    readonly healthyStatus?: (status: number) => boolean;
    readonly resolveNamesFor: (url: string) => boolean;
  },
): Promise<StreamReachabilityProbeResult> {
  if (options.parentSignal?.aborted) {
    return { status: "timeout" };
  }

  const deadline = createDeadlineSignal(options.parentSignal, options.remainingMs());

  const healthyStatus =
    options.healthyStatus ?? ((status: number) => status >= 200 && status < 300);

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url,
      init: {
        method: options.method,
        headers: options.headers,
        signal: deadline.signal,
      },
      remaining: options.remainingMs,
      parentSignal: options.parentSignal,
      resolveNamesFor: options.resolveNamesFor,
    });
    if (outcome.kind === "timeout") return { status: "timeout" };
    if (outcome.kind === "blocked") {
      return hostUnreachable(`blocked stream target: ${outcome.reason}`, true, outcome.url);
    }
    const response = outcome.response;
    await response.body?.cancel().catch(() => undefined);
    if (healthyStatus(response.status)) {
      return {
        status: "reachable",
        contentType: response.headers.get("content-type") ?? undefined,
      };
    }
    if (options.method === "HEAD" && (response.status === 403 || response.status === 405)) {
      throw new Error(`HEAD ${response.status}`);
    }
    const definitive = isDefinitiveHttpStatus(response.status);
    return { status: "unreachable", reason: `HTTP ${response.status}`, definitive };
  } catch (error) {
    if (deadline.signal.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return hostUnreachable(message, isDefinitiveNetworkError(message), url);
  } finally {
    deadline.release();
  }
}

/** Strict addon probes read this many bytes of evidence and nothing more. */
const DIRECT_MEDIA_PROBE_PREFIX_BYTES = 4096;
/** Playlist-looking paths are refused before any request is dispatched. */
const DIRECT_MEDIA_URL_DENY = /\.(?:m3u8?|mpd)$/i;

interface EbmlVint {
  readonly value: number;
  readonly end: number;
}

/**
 * One EBML variable-length integer at `offset`. With `keepMarker` the leading
 * marker bit stays in the value (element IDs); without it the marker is
 * stripped (element sizes) and the all-ones "unknown length" form is refused.
 */
function readEbmlVint(
  view: DataView,
  offset: number,
  limit: number,
  keepMarker: boolean,
): EbmlVint | null {
  if (offset >= limit) return null;
  const first = view.getUint8(offset);
  if (first === 0) return null;
  let marker = 0x80;
  let width = 1;
  while ((first & marker) === 0) {
    marker >>= 1;
    width += 1;
  }
  const end = offset + width;
  if (end > limit || (keepMarker && width > 4)) return null;
  let value = keepMarker ? first : first & (marker - 1);
  let allOnes = value === marker - 1;
  for (let index = offset + 1; index < end; index += 1) {
    const byte = view.getUint8(index);
    value = value * 256 + byte;
    allOnes = allOnes && byte === 0xff;
  }
  return Number.isSafeInteger(value) && (keepMarker || !allOnes) ? { value, end } : null;
}

/**
 * The EBML magic is only a container claim; the DocType element inside the
 * header is what names the format as "webm" or "matroska". Anything else —
 * a truncated header, an unsupported DocType, "webm" bytes under an unrelated
 * element ID — is not positive media evidence.
 */
/** Where the EBML header ends when it names a webm/matroska DocType, else null. */
function matroskaHeaderEnd(view: DataView): number | null {
  const header = readEbmlVint(view, 4, view.byteLength, false);
  if (!header) return null;
  const end = header.end + header.value;
  if (end > view.byteLength) return null;
  let docType: string | undefined;
  for (let offset = header.end; offset < end;) {
    const id = readEbmlVint(view, offset, end, true);
    if (!id) return null;
    const size = readEbmlVint(view, id.end, end, false);
    if (!size || size.value > end - size.end) return null;
    offset = size.end + size.value;
    if (id.value !== 0x4282) continue;
    if (docType !== undefined) return null;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + size.end, size.value);
    let decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    while (decoded.endsWith("\0")) decoded = decoded.slice(0, -1);
    docType = decoded;
  }
  return docType === "webm" || docType === "matroska" ? end : null;
}

const MATROSKA_SEGMENT_ID = 0x18538067;

/**
 * A complete Matroska/WebM body must continue past its EBML header into a
 * Segment element with payload; a body that ends at the header is a header
 * with no media. The Segment size may be the "unknown length" form streams use.
 */
function hasMatroskaSegment(view: DataView, headerEnd: number): boolean {
  const id = readEbmlVint(view, headerEnd, view.byteLength, true);
  if (!id || id.value !== MATROSKA_SEGMENT_ID || id.end >= view.byteLength) return false;
  const first = view.getUint8(id.end);
  if (first === 0) return false;
  let width = 1;
  for (let marker = 0x80; (first & marker) === 0; marker >>= 1) width += 1;
  return id.end + width < view.byteLength;
}

interface DirectMediaRange {
  readonly length: number;
  readonly complete: boolean;
}

/**
 * The only partial answer with evidentiary value is `bytes 0-N` — the same
 * leading span the probe asked for. A missing, malformed, nonzero-offset, or
 * impossible Content-Range means the server did not honor the request shape.
 */
function parseDirectMediaRange(value: string | null): DirectMediaRange | null {
  const match = /^bytes 0-([0-9]+)\/([0-9]+|\*)$/i.exec(value ?? "");
  if (!match) return null;
  const last = Number(match[1]);
  if (!Number.isSafeInteger(last) || last >= DIRECT_MEDIA_PROBE_PREFIX_BYTES) return null;
  const length = last + 1;
  if (match[2] === "*") return { length, complete: false };
  const total = Number(match[2]);
  return Number.isSafeInteger(total) && total >= length
    ? { length, complete: total === length }
    : null;
}

/**
 * Positive identification of a self-contained media file prefix.
 *
 * MP4-family files open with an `ftyp` box whose own payload must hold a major
 * brand and minor version; on a *complete* body the prefix must run past that
 * first box, because a file that ends at its `ftyp` is a header with no media.
 * Matroska/WebM open with the EBML magic and name their DocType inside the
 * header, so the magic alone is not enough either.
 */
function isDirectMediaPrefix(prefix: Uint8Array, complete: boolean): boolean {
  if (prefix.byteLength < 8) return false;
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  if (view.getUint32(0) === 0x1a45dfa3) {
    const headerEnd = matroskaHeaderEnd(view);
    if (headerEnd === null) return false;
    return !complete || hasMatroskaSegment(view, headerEnd);
  }
  const box = readIsoBox(view, 0);
  if (!box || box.type !== "ftyp" || box.end - box.payload < 8 || box.end > view.byteLength) {
    return false;
  }
  // A complete body must also hold at least one more complete, known top-level
  // box — an ftyp header alone, or trailing bytes that parse as nothing, is a
  // header with no media.
  return !complete || hasCompleteMp4Boxes(view, box.end);
}

/** Top-level ISO boxes that count as media evidence after `ftyp`. */
const MP4_TOP_LEVEL_BOXES = new Set([
  "moov",
  "mdat",
  "moof",
  "free",
  "skip",
  "wide",
  "sidx",
  "styp",
  "pdin",
  "meta",
  "mfra",
]);

/**
 * Every box after `ftyp` must parse and fit the body. Unknown-but-complete
 * boxes are tolerated either side of the media boxes — `known` requires at
 * least one recognized top-level box, so a prefix of nothing but foreign
 * boxes still refuses.
 */
function hasCompleteMp4Boxes(view: DataView, offset: number): boolean {
  let known = false;
  while (offset < view.byteLength) {
    const next = readIsoBox(view, offset);
    if (!next) return false;
    const end = next.end === Number.POSITIVE_INFINITY ? view.byteLength : next.end;
    if (end > view.byteLength || (next.type === "uuid" && end - next.payload < 16)) return false;
    known ||= MP4_TOP_LEVEL_BOXES.has(next.type);
    offset = end;
  }
  return known;
}

/**
 * The addon strict probe: one redirect-free range GET whose body must prove a
 * direct MP4-family or Matroska/WebM file. Playlist URLs are refused before
 * the request exists, and every non-2xx answer — including any redirect —
 * ends the probe. A rotating manifest can never answer this shape, which is
 * the point: `reachable` here attests a bounded media object, not just a live
 * URL.
 */
async function probeDirectMedia(
  input: ProbeStreamReachabilityInput,
  fetchImpl: StreamReachabilityFetch,
  resolveNamesFor: (url: string) => boolean,
): Promise<StreamReachabilityProbeResult> {
  try {
    if (DIRECT_MEDIA_URL_DENY.test(new URL(input.url).pathname)) {
      return { status: "unreachable", reason: "unsupported-direct-media", definitive: true };
    }
  } catch {
    // An unparseable URL is refused by the guarded fetch below.
  }
  const headers = input.headers ?? {};
  // A supplied Range/If-Range is a request shape this probe cannot reproduce
  // honestly — refuse the candidate instead of overriding it.
  const hasCustomRange = Object.keys(headers).some((name) => {
    const lower = name.toLowerCase();
    return lower === "range" || lower === "if-range";
  });
  if (hasCustomRange) {
    return { status: "unreachable", reason: "unsupported-direct-media", definitive: true };
  }
  const signal = input.signal
    ? AbortSignal.any([
        input.signal,
        AbortSignal.timeout(input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url: input.url,
      init: {
        method: "GET",
        headers: { ...headers, Range: `bytes=0-${DIRECT_MEDIA_PROBE_PREFIX_BYTES - 1}` },
        signal,
      },
      // The timeout lives on the signal, so the guard's deadline never
      // short-circuits early.
      remaining: () => 1,
      parentSignal: signal,
      resolveNamesFor,
      followRedirects: false,
    });
    if (outcome.kind === "timeout") return { status: "timeout" };
    if (outcome.kind === "blocked") {
      return hostUnreachable("blocked-target", true, outcome.url);
    }
    const response = outcome.response;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "unreachable", reason: "redirect-refused", definitive: true };
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: "unreachable",
        reason: `HTTP ${response.status}`,
        definitive: isDefinitiveHttpStatus(response.status),
      };
    }
    const range =
      response.status === 206 ? parseDirectMediaRange(response.headers.get("content-range")) : null;
    const declaredLength = response.headers.get("content-length");
    if (
      response.status === 206 &&
      (!range ||
        (declaredLength !== null &&
          (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== range.length)))
    ) {
      // A partial answer without a verifiable `bytes 0-N` range — or one whose
      // Content-Length contradicts that range — did not honor the request
      // shape: there is no evidence to read.
      await response.body?.cancel().catch(() => undefined);
      return { status: "unreachable", reason: "unsupported-direct-media", definitive: true };
    }
    // One byte past the target distinguishes EOF exactly at the range from an
    // overflow — an excess byte, even in a separate chunk, is a body that does
    // not match its own contract.
    const bytes = await readPrefixBytes(
      response.body,
      (range?.length ?? DIRECT_MEDIA_PROBE_PREFIX_BYTES) + 1,
    );
    if (range && bytes.byteLength !== range.length) {
      return { status: "unreachable", reason: "unsupported-direct-media", definitive: true };
    }
    // Complete means the prefix provably holds the whole object: a 206 whose
    // range covered the full length, or a 200 that ended inside the read cap.
    const complete = range?.complete ?? bytes.byteLength <= DIRECT_MEDIA_PROBE_PREFIX_BYTES;
    const prefix = bytes.subarray(0, DIRECT_MEDIA_PROBE_PREFIX_BYTES);
    if (isDirectMediaPrefix(prefix, complete)) {
      return { status: "reachable" };
    }
    return { status: "unreachable", reason: "unsupported-direct-media", definitive: true };
  } catch {
    if (signal.aborted) return { status: "timeout" };
    // No raw cause: a transport message can quote the URL it failed on.
    return hostUnreachable("network-error", false, input.url);
  }
}

function hostUnreachable(
  reason: string,
  definitive: boolean,
  url: string,
): StreamReachabilityProbeResult {
  return {
    status: "unreachable",
    reason,
    definitive,
    refusalScope: "host",
    refusalHost: streamUrlHost(url),
  };
}

export function streamUrlHost(url: string | undefined): string {
  try {
    return new URL(url ?? "").host.toLowerCase();
  } catch {
    return "";
  }
}
