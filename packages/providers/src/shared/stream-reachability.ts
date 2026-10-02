import {
  blockedLiteralTargetReason,
  isPrivateLiteralAddress,
  resolvedAddressBlockReason,
} from "@kunai/types";

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
};

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const SEGMENT_RANGE_HEADER = `bytes=0-${HLS_SEGMENT_PROBE_MIN_BYTES - 1}`;
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
    const text = await response.text();
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
      return {
        status: "unreachable",
        reason: "HLS segment unreachable: content-type text/html",
        definitive: true,
      };
    }

    const buffer = new Uint8Array(await response.arrayBuffer());
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
