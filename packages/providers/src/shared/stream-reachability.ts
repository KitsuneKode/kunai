import {
  fetchProbeTarget,
  isGuardedPlatformFetch,
  type StreamReachabilityFetch,
} from "@kunai/core";

import {
  HLS_SEGMENT_PROBE_MIN_BYTES,
  isHlsMasterPlaylist,
  isHlsPlaylistUrl,
  parseFirstHlsMediaSegmentPath,
  parseFirstHlsVariantPath,
  resolveHlsSegmentUrl,
} from "./hls-manifest";

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
  | { readonly status: "reachable" }
  | { readonly status: "unreachable"; readonly reason: string; readonly definitive: boolean }
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
const MAX_PROBE_BODY_BYTES = 256 * 1024;

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

function hasTransportStreamSync(prefix: Uint8Array): boolean {
  // One ASCII 'G' also starts ordinary text. Require three 188-byte packet boundaries.
  return (
    prefix.byteLength >= 377 && prefix[0] === 0x47 && prefix[188] === 0x47 && prefix[376] === 0x47
  );
}

type IsoBoxPrefix = { readonly type: string; readonly payload: number; readonly end: number };

function readIsoBox(view: DataView, offset: number): IsoBoxPrefix | null {
  if (offset + 8 > view.byteLength) return null;
  let size = view.getUint32(offset);
  const type = String.fromCharCode(
    ...[0, 1, 2, 3].map((index) => view.getUint8(offset + 4 + index)),
  );
  let header = 8;
  if (size === 1) {
    if (offset + 16 > view.byteLength) return null;
    const extendedSize = view.getBigUint64(offset + 8);
    if (extendedSize < 16n || extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extendedSize);
    header = 16;
  }
  if (size === 0 && type === "mdat")
    return { type, payload: offset + header, end: Number.POSITIVE_INFINITY };
  if (size < header) return null;
  const end = offset + size;
  if (!Number.isSafeInteger(end)) return null;
  return { type, payload: offset + header, end };
}

function hasTrackFragment(
  view: DataView,
  box: IsoBoxPrefix,
  minimumDataOffset: number,
  dataEndOffset: number,
): boolean {
  let header = false;
  let decodeTime = false;
  const runs: IsoBoxPrefix[] = [];
  let defaultSampleSize: number | undefined;
  for (let offset = box.payload; offset < box.end;) {
    const child = readIsoBox(view, offset);
    if (!child || child.end > box.end) return false;
    const length = child.end - child.payload;
    if (child.type === "tfhd") {
      if (header || length < 8) return false;
      const flags = view.getUint32(child.payload);
      // HLS uses fragment-relative addressing, never an absolute external base.
      if ((flags & ~0x03003a) !== 0 || view.getUint32(child.payload + 4) === 0) return false;
      const optionalFields = [2, 8, 16, 32].filter((flag) => (flags & flag) !== 0).length;
      if (length !== 8 + optionalFields * 4) return false;
      if ((flags & 0x10) !== 0) {
        const sizeOffset = child.payload + 8 + (flags & 2 ? 4 : 0) + (flags & 8 ? 4 : 0);
        defaultSampleSize = view.getUint32(sizeOffset);
      }
      header = true;
    } else if (child.type === "tfdt") {
      if (decodeTime || length < 8) return false;
      const flags = view.getUint32(child.payload);
      if (flags !== 0 && flags !== 0x01000000) return false;
      if (length !== (flags === 0 ? 8 : 12)) return false;
      decodeTime = true;
    } else if (child.type === "trun") {
      if (length < 12) return false;
      const flags = view.getUint32(child.payload);
      const version = flags >>> 24;
      const fields = flags & 0xffffff;
      if (version > 1 || (fields & ~0xf05) !== 0 || (fields & 1) === 0) return false;
      const samples = view.getUint32(child.payload + 4);
      const sampleFields = [0x100, 0x200, 0x400, 0x800].filter(
        (flag) => (fields & flag) !== 0,
      ).length;
      if (samples === 0 || length !== 12 + (fields & 4 ? 4 : 0) + samples * sampleFields * 4)
        return false;
      const sampleOffset = view.getInt32(child.payload + 8);
      if (sampleOffset < minimumDataOffset || sampleOffset >= dataEndOffset) return false;
      runs.push(child);
    }
    offset = child.end;
  }
  if (!header || !decodeTime || runs.length === 0) return false;
  if (!Number.isFinite(dataEndOffset)) return true;
  // Resolve defaults after the whole traf, so box order cannot bypass extent checks.
  for (const child of runs) {
    const fields = view.getUint32(child.payload) & 0xffffff;
    const samples = view.getUint32(child.payload + 4);
    let remaining = dataEndOffset - view.getInt32(child.payload + 8);
    if ((fields & 0x200) !== 0) {
      const stride =
        [0x100, 0x200, 0x400, 0x800].filter((flag) => (fields & flag) !== 0).length * 4;
      const firstSize = child.payload + 12 + (fields & 4 ? 4 : 0) + (fields & 0x100 ? 4 : 0);
      // Explicit sizes imply a bounded entry table already checked against box length.
      for (let index = 0; index < samples; index++) {
        const size = view.getUint32(firstSize + index * stride);
        if (size > remaining) return false;
        remaining -= size;
      }
    } else if (defaultSampleSize !== undefined) {
      // A field-free run may claim billions of samples. Never loop over that count
      // or round its product past JS's safe-integer range.
      if (BigInt(samples) * BigInt(defaultSampleSize) > BigInt(remaining)) return false;
    }
    // Otherwise sizes live in the initialization segment's trex, not this prefix.
    // Keep the structural-prefix contract; this is not a full media decode check.
  }
  return true;
}

function hasFragmentedMp4Prefix(prefix: Uint8Array): boolean {
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  for (let offset = 0; offset < prefix.byteLength;) {
    const box = readIsoBox(view, offset);
    if (!box || box.end > prefix.byteLength) return false;
    if (box.type === "moof") {
      const data = readIsoBox(view, box.end);
      if (
        !data ||
        data.type !== "mdat" ||
        data.end <= data.payload ||
        prefix.byteLength <= data.payload
      )
        return false;
      let header = false;
      let tracks = 0;
      for (let childOffset = box.payload; childOffset < box.end;) {
        const child = readIsoBox(view, childOffset);
        if (!child || child.end > box.end) return false;
        if (child.type === "mfhd") {
          if (header || child.end - child.payload !== 8 || view.getUint32(child.payload) !== 0)
            return false;
          header = true;
        } else if (child.type === "traf") {
          if (!hasTrackFragment(view, child, data.payload - offset, data.end - offset))
            return false;
          tracks++;
        }
        childOffset = child.end;
      }
      // The moof must be complete. Only mdat's media payload may extend beyond
      // the prefix; an ftyp marker alone or a truncated fragment proves nothing.
      return header && tracks > 0;
    }
    if (!["styp", "sidx", "emsg", "prft", "free", "skip"].includes(box.type)) return false;
    if (box.type === "styp" && (box.end - box.payload < 8 || (box.end - box.payload) % 4 !== 0))
      return false;
    offset = box.end;
  }
  return false;
}

/**
 * Read a full body as text only when it fits `maxBytes`; returns `null` on
 * overflow — a truncated M3U can still parse as valid markup, so the caller
 * must see "too large" rather than half a playlist. Mid-body errors rethrow
 * into the caller's classifier, matching `readPrefixBytes`.
 */
export async function readBoundedTextBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number = MAX_PROBE_BODY_BYTES,
): Promise<string | null> {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let seen = 0;
  try {
    while (seen <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        seen += value.byteLength;
      }
    }
    if (seen > maxBytes) {
      await reader.cancel("too-large").catch(() => {});
      return null;
    }
    return new TextDecoder().decode(concatBytes(chunks, seen));
  } catch (error) {
    await reader.cancel("probe-failed").catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
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
    if (head.status === "reachable") return head;
    if (head.status === "timeout") return head;
    if (head.status === "unreachable" && head.definitive) return head;
  } catch {
    if (Date.now() >= deadline) return { status: "timeout" };
  }

  if (Date.now() >= deadline) return { status: "timeout" };

  return probeHttpStatus(fetchImpl, input.url, {
    method: "GET",
    headers: { ...headers, Range: "bytes=0-0" },
    remainingMs: remaining,
    parentSignal: input.signal,
    resolveNamesFor,
    healthyStatus: (status) => (status >= 200 && status < 300) || status === 206,
  });
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining());
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url,
      init: { method: "GET", headers, signal: controller.signal },
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
        result: {
          status: "unreachable",
          reason: `blocked stream target: ${outcome.reason}`,
          definitive: true,
        },
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
    if (controller.signal.aborted || parentSignal?.aborted) {
      return { status: "fail", result: { status: "timeout" } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "fail",
      result: {
        status: "unreachable",
        reason: message,
        definitive: isDefinitiveNetworkError(message),
      },
    };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remaining());
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url,
      init: {
        method: "GET",
        headers: { ...headers, Range: SEGMENT_RANGE_HEADER },
        signal: controller.signal,
      },
      remaining,
      parentSignal,
      resolveNamesFor,
    });
    if (outcome.kind === "timeout") return { status: "timeout" };
    if (outcome.kind === "blocked") {
      return {
        status: "unreachable",
        reason: `HLS segment blocked: ${outcome.reason}`,
        definitive: true,
      };
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
    const firstBytes = await readPrefixBytes(
      response.body,
      htmlLabeled ? FMP4_PROBE_PREFIX_BYTES : HLS_SEGMENT_PROBE_MIN_BYTES,
      htmlLabeled
        ? (prefix) => hasTransportStreamSync(prefix) || hasFragmentedMp4Prefix(prefix)
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
    if (firstBytes.byteLength < HLS_SEGMENT_PROBE_MIN_BYTES) {
      return {
        status: "unreachable",
        reason: `HLS segment unreachable: body too small (${firstBytes.byteLength}B)`,
        definitive: true,
      };
    }

    return { status: "reachable" };
  } catch (error) {
    if (controller.signal.aborted || parentSignal?.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unreachable",
      reason: `HLS segment unreachable: ${message}`,
      definitive: isDefinitiveNetworkError(message),
    };
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", onParentAbort);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.remainingMs());

  const onParentAbort = () => controller.abort(options.parentSignal?.reason);
  options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const healthyStatus =
    options.healthyStatus ?? ((status: number) => status >= 200 && status < 300);

  try {
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url,
      init: {
        method: options.method,
        headers: options.headers,
        signal: controller.signal,
      },
      remaining: options.remainingMs,
      parentSignal: options.parentSignal,
      resolveNamesFor: options.resolveNamesFor,
    });
    if (outcome.kind === "timeout") return { status: "timeout" };
    if (outcome.kind === "blocked") {
      return {
        status: "unreachable",
        reason: `blocked stream target: ${outcome.reason}`,
        definitive: true,
      };
    }
    const response = outcome.response;
    await response.body?.cancel().catch(() => undefined);
    if (healthyStatus(response.status)) {
      return { status: "reachable" };
    }
    if (options.method === "HEAD" && (response.status === 403 || response.status === 405)) {
      throw new Error(`HEAD ${response.status}`);
    }
    const definitive = isDefinitiveHttpStatus(response.status);
    return { status: "unreachable", reason: `HTTP ${response.status}`, definitive };
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "unreachable",
      reason: message,
      definitive: isDefinitiveNetworkError(message),
    };
  } finally {
    clearTimeout(timeout);
    options.parentSignal?.removeEventListener("abort", onParentAbort);
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
      return { status: "unreachable", reason: "blocked-target", definitive: true };
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
    return { status: "unreachable", reason: "network-error", definitive: false };
  }
}

/**
 * Every 4xx is a refusal, and a refusal is a verdict.
 *
 * 429 was briefly treated as transient on the theory that a CDN throttling a CLI
 * probe says nothing about whether the stream plays. Live evidence says
 * otherwise: VidLink's CDN (`bcdn.hakunaymatata.com`) answers 429 to GET, HEAD
 * and ranged GET alike for every candidate, so letting the probe pass just hands
 * mpv a 587-byte nginx error page instead of a video. The gate exists to stop
 * exactly that, and a provider that fails here lets a working one take over.
 *
 * If a status ever needs to be treated as transient, it needs evidence that the
 * stream actually plays afterwards — a passing probe is not the goal, playback is.
 */
function isDefinitiveHttpStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

function isDefinitiveNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("econnrefused") ||
    lower.includes("name or service not known") ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound") ||
    lower.includes("unable to connect") ||
    lower.includes("certificate has expired") ||
    (lower.includes("certificate") && lower.includes("expired")) ||
    /*
      An unverifiable chain is as deterministic as an expired one: retrying
      cannot heal it, and mpv's TLS stack fails the same way against the same
      trust decision — so the stream must be rejected, not passed through
      lenient as "maybe a slow CDN". Covers OpenSSL/BoringSSL phrasings:
      "unable to verify the first certificate", "unable to verify leaf
      signature", "unable to get local issuer certificate",
      "self signed certificate in certificate chain".
    */
    lower.includes("unable to verify") ||
    lower.includes("unable to get local issuer") ||
    lower.includes("self signed certificate") ||
    lower.includes("certificate verify failed") ||
    lower.includes("unsupported protocol") ||
    lower.includes("unknown scheme") ||
    lower.includes("url using bad/illegal format")
  );
}
