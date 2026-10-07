import {
  HLS_SEGMENT_PROBE_MIN_BYTES,
  isHlsMasterPlaylist,
  isHlsPlaylistUrl,
  parseFirstHlsMediaSegmentPath,
  parseFirstHlsVariantPath,
  resolveHlsSegmentUrl,
} from "./hls-manifest";

export type StreamReachabilityFetch = (url: string, init: RequestInit) => Promise<Response>;

export type StreamReachabilityProbeResult =
  | { readonly status: "reachable" }
  | { readonly status: "unreachable"; readonly reason: string; readonly definitive: boolean }
  | { readonly status: "timeout" };

export type ProbeStreamReachabilityInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamReachabilityFetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const SEGMENT_RANGE_HEADER = `bytes=0-${HLS_SEGMENT_PROBE_MIN_BYTES - 1}`;
// A body read past this after the prefix is already gathered is a server
// ignoring Range and dumping the whole segment on us — cap the bleed.
const MAX_PROBE_BODY_BYTES = 256 * 1024;
const MAX_PROBE_REDIRECT_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Counts body bytes until `minBytes` are seen, then cancels the reader so the
 * socket stops draining. Returns the number of bytes observed, capped at
 * `MAX_PROBE_BODY_BYTES` — a body that never reaches `minBytes` within that
 * ceiling is treated as short anyway.
 */
async function readPrefixBytes(
  body: ReadableStream<Uint8Array> | null,
  minBytes: number,
): Promise<number> {
  if (!body) return 0;
  const reader = body.getReader();
  let seen = 0;
  try {
    while (seen < minBytes && seen < MAX_PROBE_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      seen += value?.byteLength ?? 0;
    }
    // Once the threshold is crossed the rest of the body is unread on purpose —
    // cancelling is what actually closes the transfer.
    await reader.cancel("probe-satisfied").catch(() => {});
    return Math.min(seen, MAX_PROBE_BODY_BYTES);
  } catch (error) {
    // A mid-body abort or socket error is not "body too small" — rethrow so
    // the caller's classifier maps abort → timeout and transient network
    // failures to non-definitive instead of a definitive unreachable.
    await reader.cancel("probe-failed").catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
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
 * Provider-supplied URLs are untrusted input: a page or playlist can name a
 * loopback, link-local, or LAN target and the probe would otherwise fetch it —
 * a server-side request forgery by a site's own markup. Nothing a provider
 * offers should ever be private, so the gate is simple: http(s) only, public
 * literal hosts only, and (on the real fetch path) DNS answers checked too.
 *
 * `blockedLiteralTargetReason` is the synchronous half — scheme, host shape,
 * and literal ranges, no DNS — so an injected fetch sees no extra microtask.
 * `resolvedAddressBlockReason` adds DNS answer validation for the real path.
 */
function blockedLiteralTargetReason(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unparseable URL";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `unsupported scheme ${parsed.protocol.replace(":", "") || "(none)"}`;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return "empty host";
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return `local name ${host}`;
  }
  const literal = isPrivateLiteralAddress(host);
  if (literal) return literal;
  // A single-label name is an intranet name; public DNS names always carry a dot.
  if (!host.includes(".") && !host.includes(":")) {
    return `single-label host ${host}`;
  }
  return null;
}

async function resolvedAddressBlockReason(url: string): Promise<string | null> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const resolved = await resolveHostAddresses(host);
  for (const address of resolved) {
    const reason = isPrivateLiteralAddress(address);
    if (reason) return `${reason} (DNS answer for ${host})`;
  }
  return null;
}

/** Dotted-quad parse; WHATWG URL canonicalises exotic forms before we see them. */
function parseIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;
  const parts: [number, number, number, number] = [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
  ];
  return parts.every((p) => p <= 255) ? parts : null;
}

function isPrivateIpv4(parts: readonly [number, number, number, number]): boolean {
  const a = parts[0];
  const b = parts[1];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224 // multicast + reserved + broadcast
  );
}

/** IPv6-mapped IPv4 (`::ffff:7f00:1`) and NAT64 (`64:ff9b::a9fe:1`) unwrap to v4 checks. */
function embeddedIpv4(host: string): [number, number, number, number] | null {
  const tail = host.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (tail) return parseIpv4(tail);
  const hexTail = host.match(/(?:^|:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? null;
  if (!hexTail?.[1] || !hexTail[2]) return null;
  const hi = parseInt(hexTail[1], 16);
  const lo = parseInt(hexTail[2], 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function isPrivateLiteralAddress(host: string): string | null {
  const v4 = parseIpv4(host);
  if (v4) {
    return isPrivateIpv4(v4) ? `private address ${host}` : null;
  }
  if (!host.includes(":")) return null;
  if (host === "::" || host === "::1") return `loopback address ${host}`;
  const embedded = embeddedIpv4(host);
  if (
    (host.startsWith("::ffff:") || host.startsWith("64:ff9b::")) &&
    embedded &&
    isPrivateIpv4(embedded)
  ) {
    return `private address ${host}`;
  }
  const first = parseInt(host.split(":", 1)[0] || "0", 16);
  if (
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xfe00) === 0xfc00 || // fc00::/7 ULA
    (first & 0xffc0) === 0xfec0 || // fec0::/10 site-local
    (first & 0xff00) === 0xff00 ||
    // ff00::/8 multicast
    host.startsWith("2001:db8") ||
    host.startsWith("2001:0db8")
  ) {
    return `private address ${host}`;
  }
  return null;
}

async function resolveHostAddresses(host: string): Promise<string[]> {
  if (parseIpv4(host) || host.includes(":")) return [];
  try {
    const { lookup } = await import("node:dns/promises");
    const answers = await lookup(host, { all: true });
    return answers.map((a) => a.address);
  } catch {
    // An unresolvable name fails in the fetch anyway — don't pre-empt its error.
    return [];
  }
}

export type ProbeFetchOutcome =
  | { readonly kind: "response"; readonly response: Response }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "timeout" };

/**
 * One probe request, following redirects by hand so each hop is re-validated.
 * `redirect: "manual"` keeps a trusted Location header from steering the probe
 * somewhere the initial URL was already checked not to go.
 */
async function fetchProbeTarget(options: {
  readonly fetchImpl: StreamReachabilityFetch;
  readonly url: string;
  readonly init: RequestInit;
  readonly remaining: () => number;
  readonly parentSignal?: AbortSignal;
  readonly resolveNames: boolean;
}): Promise<ProbeFetchOutcome> {
  let target = options.url;
  let init = options.init;
  for (let hop = 0; ; hop++) {
    const literalBlocked = blockedLiteralTargetReason(target);
    if (literalBlocked) {
      return { kind: "blocked", reason: `${target} -> ${literalBlocked}` };
    }
    // DNS once the literals pass — skipped when the caller already aborted so
    // a cancelled probe does not sit on a resolver round-trip.
    if (options.resolveNames && !options.parentSignal?.aborted) {
      const resolvedBlocked = await resolvedAddressBlockReason(target);
      if (resolvedBlocked) {
        return { kind: "blocked", reason: `${target} -> ${resolvedBlocked}` };
      }
    }
    if (options.remaining() <= 0) {
      return { kind: "timeout" };
    }
    // The fetch impl is invoked even on an aborted signal: abort is delivered
    // through the signal itself, which is also what injected test fetches see.
    const response = await options.fetchImpl(target, {
      ...init,
      redirect: "manual",
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (location && hop < MAX_PROBE_REDIRECT_HOPS) {
        try {
          const next = new URL(location, target);
          // Match undici's own redirect hygiene: credentials do not cross
          // origins, even when every hop individually validates as public.
          if (next.origin !== new URL(target).origin && init.headers) {
            init = { ...init, headers: stripCredentialHeaders(init.headers) };
          }
          target = next.toString();
        } catch {
          // A Location we cannot parse is a response, not a redirect.
          return { kind: "response", response };
        }
        continue;
      }
    }
    return { kind: "response", response };
  }
}

const CREDENTIAL_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

function stripCredentialHeaders(headers: RequestInit["headers"]): RequestInit["headers"] {
  // `new Headers()` already accepts every legal headers init shape.
  const clone = new Headers(headers);
  for (const name of CREDENTIAL_HEADERS) clone.delete(name);
  return clone;
}

/**
 * The same target guard for fetches that are not reachability probes — the
 * HLS ladder expands a provider-supplied master URL before the resolve gate
 * sees its variants, so it borrows the blocklist and per-hop redirect checks.
 * DNS answers are validated only when the impl is the real `fetch`; a relay
 * port resolves on the relay's side, where local answers mean nothing.
 */
export function fetchGuardedStreamTarget(options: {
  readonly fetchImpl: StreamReachabilityFetch;
  readonly url: string;
  readonly init: RequestInit;
  readonly signal?: AbortSignal;
}): Promise<ProbeFetchOutcome> {
  return fetchProbeTarget({
    fetchImpl: options.fetchImpl,
    url: options.url,
    init: { ...options.init, signal: options.signal },
    remaining: () => 1, // the caller's signal owns the deadline
    parentSignal: options.signal,
    resolveNames: options.fetchImpl === fetch,
  });
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
  const resolveNames = input.fetchImpl === undefined;

  if (isHlsPlaylistUrl(input.url)) {
    return probeHlsManifest(fetchImpl, input.url, headers, remaining, input.signal, resolveNames);
  }

  try {
    const head = await probeHttpStatus(fetchImpl, input.url, {
      method: "HEAD",
      headers,
      remainingMs: remaining,
      parentSignal: input.signal,
      resolveNames,
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
    resolveNames,
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
  resolveNames: boolean,
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
    resolveNames,
  );
  if (master.status !== "ok") {
    return master.result;
  }

  let mediaPlaylistUrl = url;
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
    mediaPlaylistUrl = resolveHlsSegmentUrl(url, variantPath);
    if (parentSignal?.aborted || remaining() <= 0) {
      return { status: "timeout" };
    }
    const variant = await fetchPlaylistText(
      fetchImpl,
      mediaPlaylistUrl,
      headers,
      remaining,
      parentSignal,
      resolveNames,
    );
    if (variant.status !== "ok") {
      return variant.result;
    }
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
    resolveNames,
  );
}

async function fetchPlaylistText(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  headers: Record<string, string>,
  remaining: () => number,
  parentSignal: AbortSignal | undefined,
  resolveNames: boolean,
): Promise<
  | { readonly status: "ok"; readonly text: string }
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
      resolveNames,
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
    return { status: "ok", text };
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
  resolveNames: boolean,
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
      resolveNames,
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
      const definitive = isDefinitiveHttpStatus(response.status);
      return {
        status: "unreachable",
        reason: `HLS segment unreachable: HTTP ${response.status}`,
        definitive,
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
      return {
        status: "unreachable",
        reason: "HLS segment unreachable: content-type text/html",
        definitive: true,
      };
    }

    // The Range header is only a request — a server free to ignore it would
    // otherwise have arrayBuffer() pull the whole segment into memory for a
    // check that only needs the first bytes. Read what we need and cut the
    // socket loose.
    const firstBytes = await readPrefixBytes(response.body, HLS_SEGMENT_PROBE_MIN_BYTES);
    if (firstBytes < HLS_SEGMENT_PROBE_MIN_BYTES) {
      return {
        status: "unreachable",
        reason: `HLS segment unreachable: body too small (${firstBytes}B)`,
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
    readonly resolveNames: boolean;
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
      resolveNames: options.resolveNames,
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
