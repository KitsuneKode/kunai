import {
  blockedLiteralTargetReason,
  isPrivateLiteralAddress,
  resolvedAddressBlockReason,
} from "@kunai/types";

import {
  readResponseBodyPrefix,
  readResponseTextCapped,
  readStreamBytesCapped,
} from "./bounded-body";
import { curlCipherArgs, resolveCurlCandidate } from "./curl-impersonate";
import {
  HLS_SEGMENT_PROBE_MIN_BYTES,
  isHlsMasterPlaylist,
  isHlsPlaylistUrl,
  parseFirstHlsMediaSegmentPath,
  parseFirstHlsVariantPath,
  resolveHlsSegmentUrl,
} from "./hls-manifest";

// Re-exported so existing `@kunai/providers` import sites keep working — the
// predicates live in @kunai/types so non-provider layers (mpv launch gating,
// poster fetch) can use the same network-range blocklist.
export { blockedLiteralTargetReason, isPrivateLiteralAddress, resolvedAddressBlockReason };

export type StreamReachabilityFetch = (url: string, init: RequestInit) => Promise<Response>;

export type StreamReachabilityProbeResult =
  | { readonly status: "reachable" }
  | {
      readonly status: "unreachable";
      readonly reason: string;
      readonly definitive: boolean;
      /**
       * The refusal is evidence about the host, not just this request: DNS
       * failures, refused connections, TLS verdicts, and SSRF-guard blocks kill
       * every URL on that host equally. HTTP status refusals and malformed-body
       * verdicts stay unset — a signed URL's 403 says nothing about a sibling
       * rung on the same CDN.
       */
      readonly hostRefusal?: boolean;
    }
  | { readonly status: "timeout" };

export type ProbeStreamReachabilityInput = {
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: StreamReachabilityFetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Transport used for the fingerprint retry: a definitive `HTTP 403` from
   * Bun's fetch can be a TLS-client verdict rather than the stream's — the
   * player-shaped clients (mpv, curl) often pass where Bun's handshake is
   * refused (miruro's `vault-*.uwucdn.top`/`owocdn.top` measured this,
   * 2026-10-03). When absent the retry resolves curl/curl-impersonate from
   * PATH; `null` disables it. The retry only fires on the platform-fetch
   * path — an injected `fetchImpl` owns its transport unless it opts in by
   * passing one explicitly.
   */
  readonly curlFetchImpl?: StreamReachabilityFetch | null;
};

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const SEGMENT_RANGE_HEADER = `bytes=0-${HLS_SEGMENT_PROBE_MIN_BYTES - 1}`;
/** Playlists are line text in the KBs — anything past this is not a playlist. */
const PLAYLIST_BODY_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PROBE_REDIRECT_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Captured at load so `resolveNames` can tell "the platform fetch" apart from
// a patched global or an injected impl — DNS revalidation is only meaningful
// when the fetch really owns the connection.
const PLATFORM_FETCH = fetch;

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
  readonly extraSensitiveHeaders?: readonly string[];
  /**
   * Skip literal/DNS checks on hop 0 only. For callers whose first URL is
   * code-fixed or user-configured (a self-hosted Invidious instance), while
   * provider-controlled redirect targets stay fully guarded.
   */
  readonly allowInitialPrivateTarget?: boolean;
}): Promise<ProbeFetchOutcome> {
  let target = options.url;
  let init = options.init;
  for (let hop = 0; ; hop++) {
    const exemptInitialHop = hop === 0 && options.allowInitialPrivateTarget === true;
    if (!exemptInitialHop) {
      const literalBlocked = blockedLiteralTargetReason(target);
      if (literalBlocked) {
        return { kind: "blocked", reason: `${target} -> ${literalBlocked}` };
      }
      // DNS once the literals pass — skipped when the caller already aborted so
      // a cancelled probe does not sit on a resolver round-trip.
      if (options.resolveNames && !options.parentSignal?.aborted) {
        const resolvedBlocked = await resolvedAddressBlockReason(
          target,
          options.parentSignal ?? undefined,
        );
        if (resolvedBlocked) {
          return { kind: "blocked", reason: `${target} -> ${resolvedBlocked}` };
        }
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
        // Release the hop's socket promptly, but a body that never drains must
        // not stall the probe — bound the cancel inside the hop's own budget.
        await Promise.race([
          response.body?.cancel("redirected").catch(() => {}) ?? Promise.resolve(),
          Bun.sleep(Math.min(500, Math.max(0, options.remaining()))),
        ]);
        try {
          const next = new URL(location, target);
          const current = new URL(target);
          // An https hop downgrading to http would expose headers already in
          // flight to passive observers — refuse before the blocklist pass.
          if (current.protocol === "https:" && next.protocol === "http:") {
            return { kind: "blocked", reason: `${target} -> https downgrade` };
          }
          // Match undici's own redirect hygiene: credentials do not cross
          // origins, even when every hop individually validates as public.
          if (next.origin !== current.origin && init.headers) {
            init = {
              ...init,
              headers: stripCredentialHeaders(init.headers, options.extraSensitiveHeaders),
            };
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

function stripCredentialHeaders(
  headers: RequestInit["headers"],
  extraSensitiveHeaders?: readonly string[],
): RequestInit["headers"] {
  // `new Headers()` already accepts every legal headers init shape.
  const clone = new Headers(headers);
  for (const name of CREDENTIAL_HEADERS) clone.delete(name);
  for (const name of extraSensitiveHeaders ?? []) clone.delete(name);
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
  /** Extra headers dropped when a redirect crosses origins (provider secrets). */
  readonly extraSensitiveHeaders?: readonly string[];
}): Promise<ProbeFetchOutcome> {
  return fetchProbeTarget({
    fetchImpl: options.fetchImpl,
    url: options.url,
    init: { ...options.init, signal: options.signal },
    remaining: () => 1, // the caller's signal owns the deadline
    parentSignal: options.signal,
    resolveNames: options.fetchImpl === PLATFORM_FETCH,
    extraSensitiveHeaders: options.extraSensitiveHeaders,
  });
}

/**
 * Provider-secret headers that must never survive a cross-origin redirect on
 * the API-fetch path. The stream probe keeps the narrower credential set on
 * purpose — mpv replays the candidate's real headers, so the probe mirrors
 * what the player will actually send.
 */
export const PROVIDER_API_SENSITIVE_HEADERS: readonly string[] = [
  "x-aa-boot",
  "x-build-id",
  "x-session-token",
  "referer",
  "origin",
];

/**
 * A `fetch`-shaped wrapper that runs every request through the literal/DNS
 * private-target guard and follows redirects hop-by-hop with per-hop
 * revalidation, stripping credentials (plus `extraSensitiveHeaders`) on
 * cross-origin hops. Blocked or timed-out requests reject, matching fetch's
 * own failure contract, so callers need no new handling.
 */
export function createGuardedFetch(
  options: {
    readonly fetchImpl?: StreamReachabilityFetch;
    readonly extraSensitiveHeaders?: readonly string[];
    /**
     * The first request URL is code-fixed or user-configured (e.g. a
     * self-hosted Invidious instance), so literal private targets pass on
     * hop 0. Redirect hops — the attacker-controlled part — stay guarded.
     */
    readonly allowInitialPrivateTarget?: boolean;
  } = {},
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    // Resolved per call so a test patching `globalThis.fetch` still intercepts;
    // the identity check against the load-time capture decides whether the
    // impl in use is really the platform fetch (and thus merits DNS checks).
    const fetchImpl = options.fetchImpl ?? fetch;
    const request = await normalizeGuardedRequest(input, init);
    const outcome = await fetchProbeTarget({
      fetchImpl,
      url: request.url,
      init: request.init,
      remaining: () => 1,
      parentSignal: request.init.signal ?? undefined,
      resolveNames: fetchImpl === PLATFORM_FETCH,
      extraSensitiveHeaders: options.extraSensitiveHeaders,
      allowInitialPrivateTarget: options.allowInitialPrivateTarget,
    });
    if (outcome.kind === "response") return outcome.response;
    throw new Error(
      outcome.kind === "blocked"
        ? `Blocked unsafe fetch target: ${outcome.reason}`
        : "Guarded fetch timed out",
    );
  };
}

/**
 * Collapse `string | URL | Request` + `init` into the `(url, init)` shape the
 * hop loop follows. A `Request`'s own method/headers/signal are honored even
 * when `init` is absent, and its body is materialized once so the bytes stay
 * re-sendable if a redirect replays the request at a validated next hop.
 */
async function normalizeGuardedRequest(
  input: string | URL | Request,
  init: RequestInit | undefined,
): Promise<{ url: string; init: RequestInit }> {
  if (!(input instanceof Request)) {
    return { url: typeof input === "string" ? input : input.toString(), init: init ?? {} };
  }
  const headers = new Headers(input.headers);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  const method = init?.method ?? input.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body: RequestInit["body"] =
    init?.body ?? (hasBody ? await input.clone().arrayBuffer() : undefined);
  return {
    url: input.url,
    init: { ...init, method, headers, body },
  };
}

/** Quick manifest/segment probe used before accepting a provider candidate or handing off to mpv. */
export async function probeStreamReachability(
  input: ProbeStreamReachabilityInput,
): Promise<StreamReachabilityProbeResult> {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
  const remaining = () => Math.max(100, deadline - Date.now());
  // Injected fetches own their destinations; real fetches get DNS answers
  // re-validated so a public name cannot resolve to a private address.
  const resolveNames = input.fetchImpl === undefined;

  const first = await probeStreamReachabilityOnce(
    input,
    input.fetchImpl ?? fetch,
    deadline,
    remaining,
    resolveNames,
  );
  if (
    first.status !== "unreachable" ||
    first.definitive !== true ||
    !isFingerprintRetryStatus(first.reason) ||
    input.signal?.aborted === true ||
    (input.fetchImpl !== undefined && input.curlFetchImpl === undefined)
  ) {
    return first;
  }
  const curlFetch =
    input.curlFetchImpl === undefined ? resolveDefaultCurlProbeFetch() : input.curlFetchImpl;
  if (curlFetch === null) return first;
  // Curl is the player-shaped client — its verdict replaces the Bun refusal
  // outright: a reach is proof the fingerprint was the problem, a repeated or
  // different definitive status is the more accurate death verdict, and an
  // inconclusive outcome honestly degrades to "not proven dead".
  return probeStreamReachabilityOnce(input, curlFetch, deadline, remaining, resolveNames);
}

function probeStreamReachabilityOnce(
  input: ProbeStreamReachabilityInput,
  fetchImpl: StreamReachabilityFetch,
  deadline: number,
  remaining: () => number,
  resolveNames: boolean,
): Promise<StreamReachabilityProbeResult> {
  const headers = input.headers ?? {};

  if (isHlsPlaylistUrl(input.url)) {
    return probeHlsManifest(fetchImpl, input.url, headers, remaining, input.signal, resolveNames);
  }

  return (async () => {
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
  })();
}

/**
 * The statuses a second client can legitimately overturn. 403 is the TLS-
 * fingerprint verdict CDNs hand Bun while curl/mpv pass — worth one retry with
 * the player-shaped transport. Other 4xx are content verdicts (expired
 * signature, wrong referer, quota) that a different client identity does not
 * change; 5xx are already non-definitive so they never reach this check.
 */
function isFingerprintRetryStatus(reason: string): boolean {
  return reason.includes("HTTP 403");
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
          hostRefusal: true,
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
    // A playlist is line-oriented text in the KBs — a chunked body sized only
    // by the request timeout is not a playlist, it is a memory leak.
    const text = await readResponseTextCapped(response, PLAYLIST_BODY_MAX_BYTES);
    if (text === null) {
      return {
        status: "fail",
        result: {
          status: "unreachable",
          reason: `playlist body unreadable or exceeds ${PLAYLIST_BODY_MAX_BYTES} bytes`,
          definitive: false,
        },
      };
    }
    return { status: "ok", text };
  } catch (error) {
    if (controller.signal.aborted || parentSignal?.aborted) {
      return { status: "fail", result: { status: "timeout" } };
    }
    const message = error instanceof Error ? error.message : String(error);
    const definitive = isDefinitiveNetworkError(message);
    return {
      status: "fail",
      result: {
        status: "unreachable",
        reason: message,
        definitive,
        // DNS, refused connections, and TLS verdicts are host-scoped evidence.
        ...(definitive ? { hostRefusal: true as const } : null),
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
        hostRefusal: true,
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
      // A declared HTML type is meant to catch the CDN error page masquerading
      // as a segment — but upstreams also disguise real segments as HTML to
      // defeat exactly this check (vidrock's obsidiancircuit lane serves 2.6MB
      // of MPEG-TS as `page-N.html`, measured 2026-10-03). The bytes are the
      // evidence: refuse only when the body is not actually TS.
      const prefix = await readResponseBodyPrefix(response, HLS_SEGMENT_PROBE_MIN_BYTES);
      if (prefix === null || !hasMpegTsSyncSignature(prefix)) {
        return {
          status: "unreachable",
          reason: "HLS segment unreachable: content-type text/html",
          definitive: true,
        };
      }
      return { status: "reachable" };
    }

    // Range asks politely; this enforces it. A host that answers a 1KiB Range
    // request with a full 200 segment would otherwise be buffered whole into
    // memory — per candidate, per probe.
    const buffer = await readResponseBodyPrefix(response, HLS_SEGMENT_PROBE_MIN_BYTES);
    if (buffer === null) {
      // Mid-body disconnect, not an empty file — the CDN answered and then
      // died; a sibling rung may still be fine.
      return {
        status: "unreachable",
        reason: "HLS segment unreachable: body read failed",
        definitive: false,
      };
    }
    if (buffer.byteLength < HLS_SEGMENT_PROBE_MIN_BYTES) {
      return {
        status: "unreachable",
        reason: `HLS segment unreachable: body too small (${buffer.byteLength}B)`,
        definitive: true,
      };
    }

    return { status: "reachable" };
  } catch (error) {
    if (controller.signal.aborted || parentSignal?.aborted) {
      return { status: "timeout" };
    }
    const message = error instanceof Error ? error.message : String(error);
    const definitive = isDefinitiveNetworkError(message);
    return {
      status: "unreachable",
      reason: `HLS segment unreachable: ${message}`,
      definitive,
      ...(definitive ? { hostRefusal: true as const } : null),
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
        hostRefusal: true,
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
    const definitive = isDefinitiveNetworkError(message);
    return {
      status: "unreachable",
      reason: message,
      definitive,
      ...(definitive ? { hostRefusal: true as const } : null),
    };
  } finally {
    clearTimeout(timeout);
    options.parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * MPEG-TS packets are 188 bytes, each opening with the 0x47 sync byte — two
 * consecutive syncs are ~1-in-65k by accident, three ~1-in-16M, so matching
 * (0, 188, 376) is reliable proof of TS. A 4-byte-prefixed m2ts variant (sync
 * at 4, 196, 384+4) exists but is rare in HLS; checking the plain layout
 * keeps the rescue honest instead of "any binary blob passes".
 */
function hasMpegTsSyncSignature(buffer: Uint8Array): boolean {
  return (
    buffer.byteLength > 376 && buffer[0] === 0x47 && buffer[188] === 0x47 && buffer[376] === 0x47
  );
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

/* ------------------------------------------------------------------------ */
/* Curl fallback transport — the player-shaped client                        */
/* ------------------------------------------------------------------------ */

/**
 * `%{redirect_url}` and `%{content_type}` ride the `-w` trailer so redirect
 * hops can be walked in-process — `-L` would hand them to curl without the
 * per-hop target validation `fetchProbeTarget` owns.
 */
const CURL_PROBE_MARKER = "\n__KUNAI_PROBE__:";
const CURL_PROBE_WRITE_OUT = "\n__KUNAI_PROBE__:%{http_code}\t%{redirect_url}\t%{content_type}";
const CURL_PROBE_MARKER_BYTES = new TextEncoder().encode(CURL_PROBE_MARKER);
/** The trailer is ~100 bytes; a wider window would be scanning body. */
const CURL_PROBE_TRAILER_WINDOW = 1024;
/** Segment/playlist probes read bounded bodies — the cap guards the misbehaving rest. */
const CURL_PROBE_BODY_MAX_BYTES = 4 * 1024 * 1024;
const CURL_PROBE_CONNECT_TIMEOUT_SEC = 5;
/** Backstop only; the caller's AbortSignal is the real deadline. */
const CURL_PROBE_MAX_TIME_SEC = 30;

export type CurlProbeSpawn = (
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<{ readonly stdout: Uint8Array; readonly stderr: string; readonly exitCode: number }>;

async function spawnCurlProbeOnce(args: readonly string[], signal?: AbortSignal) {
  const proc = Bun.spawn([...args], { stdout: "pipe", stderr: "pipe", signal });
  const [stdout, stderr, exitCode] = await Promise.all([
    readStreamBytesCapped(proc.stdout, CURL_PROBE_BODY_MAX_BYTES),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (stdout === null) {
    proc.kill();
    await proc.exited.catch(() => {});
    return {
      stdout: new Uint8Array(),
      stderr: `stdout exceeded ${CURL_PROBE_BODY_MAX_BYTES} bytes`,
      exitCode: exitCode === 0 ? 63 : exitCode,
    };
  }
  return { stdout, stderr, exitCode };
}

/** `%{redirect_url}`/`%{content_type}` are single-line values — tabs cannot appear in them. */
function interpretCurlProbeResult(
  stdout: Uint8Array,
  stderr: string,
): {
  readonly status: number;
  readonly redirectUrl: string | null;
  readonly contentType: string | null;
  readonly body: Uint8Array;
} {
  const window = stdout.subarray(Math.max(0, stdout.byteLength - CURL_PROBE_TRAILER_WINDOW));
  let markerAt = -1;
  for (let i = window.byteLength - CURL_PROBE_MARKER_BYTES.byteLength; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < CURL_PROBE_MARKER_BYTES.byteLength; j++) {
      if (window[i + j] !== CURL_PROBE_MARKER_BYTES[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      markerAt = i;
      break;
    }
  }
  if (markerAt < 0) {
    throw new Error(stderr.trim() || "curl returned without an HTTP response");
  }
  const trailer = new TextDecoder()
    .decode(window.subarray(markerAt + CURL_PROBE_MARKER_BYTES.byteLength))
    .trim();
  const [statusText = "", redirectUrl = "", contentType = ""] = trailer.split("\t");
  const status = Number.parseInt(statusText, 10);
  // Response's constructor only accepts real HTTP statuses — anything else
  // means curl's trailer was truncated, which is a transport fault.
  if (!Number.isFinite(status) || status < 200 || status > 599) {
    throw new Error(stderr.trim() || "curl returned without an HTTP status");
  }
  const bodyEnd = stdout.byteLength - window.byteLength + markerAt;
  return {
    status,
    redirectUrl: redirectUrl || null,
    contentType: contentType || null,
    body: stdout.subarray(0, bodyEnd),
  };
}

/** Statuses whose responses are defined as bodiless — Response rejects a body for them. */
const CURL_NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export type CurlReachabilityFetchOptions = {
  readonly curlPath: string;
  /**
   * True when `curlPath` is a curl-impersonate wrapper — it already ships the
   * browser handshake, so forcing a cipher list would undo the fingerprint it
   * exists to provide.
   */
  readonly impersonates?: boolean;
  /** Spawn seam for tests — drives outcomes without a real binary. */
  readonly spawn?: CurlProbeSpawn;
};

/**
 * A `StreamReachabilityFetch` backed by curl — the player-shaped transport for
 * the 403-fingerprint retry. Redirects are never followed (`-L` absent): the
 * hop walker re-validates each `Location` target itself. The URL is terminated
 * by `--` because provider streams can begin with an option-shaped path.
 */
export function createCurlReachabilityFetch(
  options: CurlReachabilityFetchOptions,
): StreamReachabilityFetch {
  return async (url, init) => {
    const method = (init.method ?? "GET").toUpperCase();
    const args = [
      options.curlPath,
      // First argv only: curl reads ~/.curlrc unless -q leads the command line.
      "-q",
      ...curlCipherArgs(options.impersonates === true),
      "-sS",
      "--compressed",
      "--connect-timeout",
      String(CURL_PROBE_CONNECT_TIMEOUT_SEC),
      "--max-filesize",
      String(CURL_PROBE_BODY_MAX_BYTES),
      "--max-time",
      String(CURL_PROBE_MAX_TIME_SEC),
      ...(method === "HEAD" ? ["-I"] : method === "GET" ? [] : ["-X", method]),
    ];
    new Headers(init.headers).forEach((value, name) => {
      args.push("-H", `${name}: ${value}`);
    });
    args.push("-w", CURL_PROBE_WRITE_OUT, "-o", "-", "--", url);

    const spawn = options.spawn ?? spawnCurlProbeOnce;
    const result = await spawn(args, init.signal ?? undefined);
    if (init.signal?.aborted) {
      throw init.signal.reason instanceof Error ? init.signal.reason : new Error("aborted");
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `curl exit ${result.exitCode}`);
    }
    const { status, redirectUrl, contentType, body } = interpretCurlProbeResult(
      result.stdout,
      result.stderr,
    );
    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    if (redirectUrl) headers.set("location", redirectUrl);
    return new Response(
      body.byteLength === 0 || CURL_NULL_BODY_STATUSES.has(status) ? null : body,
      { status, headers },
    );
  };
}

/** curl/curl-impersonate from PATH, or null on a machine with neither. */
function resolveDefaultCurlProbeFetch(): StreamReachabilityFetch | null {
  const curl = resolveCurlCandidate();
  if (curl === null) return null;
  return createCurlReachabilityFetch({ curlPath: curl.path, impersonates: curl.impersonates });
}
