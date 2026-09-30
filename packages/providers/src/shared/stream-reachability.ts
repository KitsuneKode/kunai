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
  /**
   * DNS answer source for the real network path — validates answers and pins
   * the connection to a checked address. Supply it when `fetchImpl` opens
   * local sockets through a wrapper the identity check cannot see through
   * (the provider fetch port); injected fetches own their targets and skip it.
   */
  readonly lookupImpl?: StreamReachabilityLookup;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

/** Guarded fetches (subtitles, playlists, manifests) get a wider budget than probes. */
const DEFAULT_GUARDED_FETCH_TIMEOUT_MS = 20_000;
const SEGMENT_RANGE_HEADER = `bytes=0-${HLS_SEGMENT_PROBE_MIN_BYTES - 1}`;
const MAX_PROBE_REDIRECT_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

/**
 * A DNS answer source. The default is the system resolver; tests inject one so
 * the validation-and-pin path runs without touching the network.
 */
export type StreamReachabilityLookup = (host: string) => Promise<readonly string[]>;

export const systemDnsLookup: StreamReachabilityLookup = async (host) => {
  const { lookup } = await import("node:dns/promises");
  const answers = await lookup(host, { all: true });
  return answers.map((answer) => answer.address);
};

/**
 * The platform's real fetch, captured at module load before tests can swap
 * `globalThis.fetch` for a stub. Only the real impl opens sockets the system
 * resolver answers for — a stubbed global owns its destinations, and pinning
 * it would rewrite URLs the stub never resolves while doing real DNS on names
 * that exist only in the fixture.
 */
const PLATFORM_FETCH: typeof fetch = fetch;

/**
 * Which lookup a stream fetch through this port needs.
 *
 * `undefined` means the global `fetch` — local sockets when it is still the
 * platform's own, none when a stub has replaced it. A port that declares
 * `resolvesLocally` opens local sockets for stream URLs (the relay port's
 * relay branch only covers allowlisted metadata hosts) even though its bound
 * method never matches the `=== fetch` identity check — also pin. Any other
 * port resolves where it runs, and local answers mean nothing there.
 */
export function probeLookupForPort(
  port: { readonly resolvesLocally?: boolean } | undefined,
): StreamReachabilityLookup | undefined {
  if (port === undefined) {
    return fetch === PLATFORM_FETCH ? systemDnsLookup : undefined;
  }
  return port.resolvesLocally === true ? systemDnsLookup : undefined;
}

type PinnedTarget =
  | { readonly kind: "pinned"; readonly url: string; readonly init: RequestInit }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "timeout" };

/**
 * Resolve, validate, and pin the connection for one request.
 *
 * Checking `lookup` once and then fetching the hostname leaves a rebinding
 * window — the name can answer a public address for the check and a private
 * one for the fetch. Pinning rewrites the request to a validated address while
 * `Host` and TLS `serverName` keep the real authority, so the connection that
 * opens is the one the DNS check covered. The target URL stays a hostname —
 * redirects resolve against it and each hop re-pins.
 *
 * The request is rewritten onto the validated address. `proxy: false` is set
 * so a proxy is not asked to resolve the name again; Bun 1.4 is not proven
 * to honor that flag, so the pin itself is the IP literal.
 *
 * Fails closed: an empty or failed lookup cannot prove the name stays public
 * through the fetch's own resolution, so it is a blocked target — the same
 * definitive-unreachable the fetch itself would report for ENOTFOUND.
 */
async function pinTargetToResolvedAddress(options: {
  readonly target: string;
  readonly init: RequestInit;
  readonly remaining: () => number;
  readonly parentSignal?: AbortSignal;
  readonly lookupImpl: StreamReachabilityLookup;
}): Promise<PinnedTarget> {
  const parsed = new URL(options.target);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // A literal is already its own pin — the literal check ran upstream — but
  // Host still has to name this URL's authority, or a redirect hop would carry
  // whatever Host an earlier pinned hop set.
  if (parseIpv4(hostname) || hostname.includes(":")) {
    const headers = new Headers(options.init.headers);
    headers.set("host", parsed.host);
    return { kind: "pinned", url: options.target, init: { ...options.init, headers } };
  }

  const addresses = await lookupWithDeadline(
    options.lookupImpl,
    hostname,
    options.remaining,
    options.parentSignal,
  );
  if (addresses === "timeout") return { kind: "timeout" };
  if (addresses === null || addresses.length === 0) {
    return {
      kind: "blocked",
      reason: `${options.target} -> DNS lookup failed or returned no answers for ${hostname}`,
    };
  }
  for (const address of addresses) {
    const reason = isPrivateLiteralAddress(address);
    if (reason) {
      return {
        kind: "blocked",
        reason: `${options.target} -> ${reason} (DNS answer for ${hostname})`,
      };
    }
  }

  const pinned = addresses[0];
  if (pinned === undefined) {
    return { kind: "blocked", reason: `${options.target} -> no DNS answer for ${hostname}` };
  }
  const authority = pinned.includes(":") ? `[${pinned}]` : pinned;
  const pinnedUrl = `${parsed.protocol}//${authority}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}${parsed.search}${parsed.hash}`;

  const headers = new Headers(options.init.headers);
  // Host keeps the real authority — the address only names the socket.
  headers.set("host", parsed.host);
  const init: RequestInit & {
    tls?: { serverName?: string };
    proxy?: boolean;
  } = { ...options.init, headers, proxy: false };
  if (parsed.protocol === "https:") {
    init.tls = { serverName: hostname };
  }
  return { kind: "pinned", url: pinnedUrl, init };
}

/**
 * `dns.lookup` cannot be cancelled, so the deadline and the abort signal race
 * it rather than interrupt it — a slow resolver used to hold the probe past
 * its budget. The orphaned lookup resolves late and is discarded.
 */
async function lookupWithDeadline(
  lookupImpl: StreamReachabilityLookup,
  host: string,
  remaining: () => number,
  parentSignal: AbortSignal | undefined,
): Promise<readonly string[] | "timeout" | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      lookupImpl(host).then(
        (addresses) => addresses,
        () => null,
      ),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), Math.max(1, remaining()));
      }),
      new Promise<"timeout">((resolve) => {
        if (parentSignal?.aborted) {
          resolve("timeout");
          return;
        }
        onAbort = () => resolve("timeout");
        parentSignal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (parentSignal && onAbort) {
      parentSignal.removeEventListener("abort", onAbort);
    }
  }
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

/** IPv6-mapped IPv4 (`::ffff:7f00:1`), NAT64 (`64:ff9b::`), 6to4 (`2002::/16`), and Teredo (`2001:0::/32`). */
function embeddedIpv4(host: string): [number, number, number, number] | null {
  const sixToFour = host.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(?::|$)/);
  if (sixToFour?.[1] && sixToFour[2]) {
    return hextetPairToIpv4(sixToFour[1], sixToFour[2]);
  }
  const teredo = host.match(/^2001:0(?::[0-9a-f]{0,4})*::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (teredo?.[1] && teredo[2]) {
    const raw = hextetPairToIpv4(teredo[1], teredo[2]);
    return raw ? [raw[0] ^ 0xff, raw[1] ^ 0xff, raw[2] ^ 0xff, raw[3] ^ 0xff] : null;
  }
  const tail = host.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (tail) return parseIpv4(tail);
  const hexTail = host.match(/(?:^|:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/) ?? null;
  if (!hexTail?.[1] || !hexTail[2]) return null;
  const hi = parseInt(hexTail[1], 16);
  const lo = parseInt(hexTail[2], 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function hextetPairToIpv4(hi: string, lo: string): [number, number, number, number] | null {
  const a = parseInt(hi, 16);
  const b = parseInt(lo, 16);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > 0xffff || b > 0xffff) return null;
  return [a >> 8, a & 0xff, b >> 8, b & 0xff];
}

export function blockedLiteralAddressReason(host: string): string | null {
  return isPrivateLiteralAddress(host.replace(/^\[|\]$/g, "").toLowerCase());
}

function isPrivateLiteralAddress(host: string): string | null {
  const v4 = parseIpv4(host);
  if (v4) {
    return isPrivateIpv4(v4) ? `private address ${host}` : null;
  }
  if (!host.includes(":")) return null;
  if (host === "::" || host === "::1") return `loopback address ${host}`;
  const embedded = embeddedIpv4(host);
  const unwraps =
    host.startsWith("::ffff:") ||
    host.startsWith("64:ff9b::") ||
    host.startsWith("2002:") ||
    host.startsWith("2001:0");
  if (unwraps && embedded && isPrivateIpv4(embedded)) {
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
  /**
   * When set, every hop resolves the name, validates the answers, and pins the
   * connection to a checked address. Absent means the impl owns its targets —
   * injected fetches and remote-resolving ports — and only the literal
   * blocklist applies.
   */
  readonly lookupImpl?: StreamReachabilityLookup;
}): Promise<ProbeFetchOutcome> {
  let target = options.url;
  let init = options.init;
  for (let hop = 0; ; hop++) {
    const literalBlocked = blockedLiteralTargetReason(target);
    if (literalBlocked) {
      return { kind: "blocked", reason: `${target} -> ${literalBlocked}` };
    }
    let requestUrl = target;
    let requestInit = init;
    // DNS once the literals pass — skipped when the caller already aborted so
    // a cancelled probe does not sit on a resolver round-trip. The pin makes
    // the connection the check covered; the name alone would leave a
    // public-then-private rebinding window.
    if (options.lookupImpl && !options.parentSignal?.aborted) {
      const pinned = await pinTargetToResolvedAddress({
        target,
        init,
        remaining: options.remaining,
        parentSignal: options.parentSignal,
        lookupImpl: options.lookupImpl,
      });
      if (pinned.kind !== "pinned") {
        return pinned;
      }
      requestUrl = pinned.url;
      requestInit = pinned.init;
    }
    if (options.remaining() <= 0) {
      return { kind: "timeout" };
    }
    // The fetch impl is invoked even on an aborted signal: abort is delivered
    // through the signal itself, which is also what injected test fetches see.
    const response = await options.fetchImpl(requestUrl, {
      ...requestInit,
      redirect: "manual",
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (location && hop < MAX_PROBE_REDIRECT_HOPS) {
        try {
          // Resolves against the hostname URL, never the pinned address, so a
          // relative Location keeps the real authority for the next hop's pin.
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
  /**
   * Shared budget for the DNS pin and the fetch itself. The signal still
   * aborts sooner; this exists because `remaining` feeds the lookup race —
   * a stub budget there starves the resolver and every hostname fetch times
   * out without issuing a request.
   */
  readonly timeoutMs?: number;
  /**
   * Passed by callers whose impl is a port that opens local sockets — the
   * relay fetch port's stream URLs always take its direct branch, so DNS
   * answers still need validating and pinning. Absent with an injected impl
   * means the impl owns its targets and only the literal blocklist applies.
   */
  readonly lookupImpl?: StreamReachabilityLookup;
}): Promise<ProbeFetchOutcome> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_GUARDED_FETCH_TIMEOUT_MS);
  return fetchProbeTarget({
    fetchImpl: options.fetchImpl,
    url: options.url,
    init: { ...options.init, signal: options.signal },
    remaining: () => Math.max(0, deadline - Date.now()),
    parentSignal: options.signal,
    lookupImpl:
      options.lookupImpl ?? (options.fetchImpl === PLATFORM_FETCH ? systemDnsLookup : undefined),
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
  // Injected fetches own their destinations; the real network path validates
  // DNS answers and pins the connection, so a public name cannot resolve to a
  // private address between the check and the fetch.
  const lookupImpl =
    input.lookupImpl ??
    ((input.fetchImpl ?? fetch) === PLATFORM_FETCH ? systemDnsLookup : undefined);

  if (isHlsPlaylistUrl(input.url)) {
    return probeHlsManifest(fetchImpl, input.url, headers, remaining, input.signal, lookupImpl);
  }

  try {
    const head = await probeHttpStatus(fetchImpl, input.url, {
      method: "HEAD",
      headers,
      remainingMs: remaining,
      parentSignal: input.signal,
      lookupImpl,
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
    lookupImpl,
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
  lookupImpl: StreamReachabilityLookup | undefined,
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
    lookupImpl,
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
      lookupImpl,
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
  return probeHlsMediaSegment(fetchImpl, segmentUrl, headers, remaining, parentSignal, lookupImpl);
}

async function fetchPlaylistText(
  fetchImpl: StreamReachabilityFetch,
  url: string,
  headers: Record<string, string>,
  remaining: () => number,
  parentSignal: AbortSignal | undefined,
  lookupImpl: StreamReachabilityLookup | undefined,
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
      lookupImpl,
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
    const text = await response.text();
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
  lookupImpl: StreamReachabilityLookup | undefined,
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
      lookupImpl,
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
    readonly lookupImpl?: StreamReachabilityLookup;
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
      lookupImpl: options.lookupImpl,
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
