export type StreamReachabilityFetch = (url: string, init: RequestInit) => Promise<Response>;

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
 * The network path validates DNS answers and connects only to a vetted IP.
 */
export function blockedLiteralTargetReason(url: string): string | null {
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
  if (!host.includes(".") && !host.includes(":")) {
    return `single-label host ${host}`;
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
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
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
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfec0 ||
    (first & 0xff00) === 0xff00 ||
    host.startsWith("2001:db8") ||
    host.startsWith("2001:0db8")
  ) {
    return `private address ${host}`;
  }
  return null;
}

async function resolveHostAddresses(host: string): Promise<string[]> {
  if (parseIpv4(host) || host.includes(":")) return [host];
  try {
    const { lookup } = await import("node:dns/promises");
    const answers = await lookup(host, { all: true });
    return answers.map((a) => a.address);
  } catch {
    return [];
  }
}

export type ProbeFetchOutcome =
  | {
      readonly kind: "response";
      readonly response: Response;
      /** The URL the last hop actually fetched — redirect targets change the
       *  base that relative playlist URIs resolve against. */
      readonly finalUrl: string;
    }
  | { readonly kind: "blocked"; readonly reason: string }
  | { readonly kind: "timeout" };

/**
 * The platform `fetch` as it existed when this module loaded.
 *
 * `fetchGuardedStreamTarget` treats `fetchImpl === platformFetch` as "this is
 * the real network path, so DNS-check the answers". Tests stub
 * `globalThis.fetch` and then pass that same binding, which made a live
 * `=== fetch` identity true and turned every documentation host
 * (`example.com` → 192.0.2.1) or DNS sinkhole into `blocked-target`.
 * Comparing against the captured platform function keeps DNS on the real
 * path and off the stubbed one.
 */
const platformFetch: typeof fetch = fetch;

/** True only for the platform `fetch` captured at module load — not a stub of `globalThis.fetch`. */
export function isGuardedPlatformFetch(fetchImpl: StreamReachabilityFetch): boolean {
  return fetchImpl === platformFetch;
}

/**
 * One probe request, following redirects by hand so each hop is re-validated.
 * `redirect: "manual"` keeps a trusted Location header from steering the probe
 * somewhere the initial URL was already checked not to go.
 */
const DNS_CACHE_TTL_MS = 30_000;
const DNS_CACHE_MAX_ENTRIES = 256;
const vettedDnsCache = new Map<
  string,
  { readonly addresses: readonly string[]; readonly expiresAt: number }
>();

async function resolveVettedHostAddressesCached(host: string): Promise<readonly string[]> {
  const key = host.toLowerCase();
  const now = Date.now();
  const cached = vettedDnsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.addresses;
  }
  const addresses = await resolveHostAddresses(host);
  if (addresses.length === 0) return addresses;
  for (const address of addresses) {
    if (isPrivateLiteralAddress(address)) return addresses;
  }
  const ordered = [
    ...addresses.filter((address) => !address.includes(":")),
    ...addresses.filter((address) => address.includes(":")),
  ];
  if (vettedDnsCache.size >= DNS_CACHE_MAX_ENTRIES) {
    const oldest = vettedDnsCache.keys().next().value;
    if (oldest !== undefined) vettedDnsCache.delete(oldest);
  }
  vettedDnsCache.set(key, { addresses: ordered, expiresAt: now + DNS_CACHE_TTL_MS });
  return ordered;
}

export async function fetchProbeTarget(options: {
  readonly fetchImpl: StreamReachabilityFetch;
  readonly url: string;
  readonly init: RequestInit;
  readonly remaining: () => number;
  readonly parentSignal?: AbortSignal;
  readonly resolveNamesFor: (url: string) => boolean;
  /** Resolver seam; production uses the system resolver and pins its answer. */
  readonly resolveAddresses?: (host: string) => Promise<readonly string[]>;
}): Promise<ProbeFetchOutcome> {
  let target = options.url;
  let init = options.init;
  for (let hop = 0; ; hop++) {
    const literalBlocked = blockedLiteralTargetReason(target);
    if (literalBlocked) {
      return { kind: "blocked", reason: `${target} -> ${literalBlocked}` };
    }
    let pinnedCandidates:
      | {
          readonly parsed: URL;
          readonly host: string;
          readonly addresses: readonly string[];
        }
      | undefined;
    if (options.resolveNamesFor(target) && !options.parentSignal?.aborted) {
      const parsed = new URL(target);
      const host = parsed.hostname.replace(/^\[|\]$/g, "");
      const addresses = await (options.resolveAddresses ?? resolveVettedHostAddressesCached)(host);
      if (addresses.length === 0) {
        return { kind: "blocked", reason: `No vetted DNS address for ${host}` };
      }
      for (const address of addresses) {
        const reason = isPrivateLiteralAddress(address);
        if (reason) return { kind: "blocked", reason: `${reason} (DNS answer for ${host})` };
      }
      pinnedCandidates = { parsed, host, addresses };
    }
    if (options.remaining() <= 0) {
      return { kind: "timeout" };
    }
    let response: Response | undefined;
    if (pinnedCandidates) {
      let lastError: unknown;
      for (const address of pinnedCandidates.addresses) {
        if (options.parentSignal?.aborted || options.remaining() <= 0) {
          return { kind: "timeout" };
        }
        const pinned = new URL(target);
        pinned.hostname = address.includes(":") ? `[${address}]` : address;
        const headers = new Headers(init.headers);
        headers.set("Host", pinnedCandidates.parsed.host);
        const requestInit: RequestInit & { proxy?: false; tls?: { serverName: string } } = {
          ...init,
          headers,
          proxy: false,
          ...(pinnedCandidates.parsed.protocol === "https:"
            ? { tls: { serverName: pinnedCandidates.host } }
            : {}),
        };
        try {
          response = await options.fetchImpl(pinned.toString(), {
            ...requestInit,
            redirect: "manual",
          });
          break;
        } catch (error) {
          lastError = error;
          if (options.parentSignal?.aborted) throw error;
        }
      }
      if (!response) throw lastError;
    } else {
      response = await options.fetchImpl(target, {
        ...init,
        redirect: "manual",
      });
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (location && hop < MAX_PROBE_REDIRECT_HOPS) {
        try {
          const next = new URL(location, target);
          if (next.origin !== new URL(target).origin && init.headers) {
            init = { ...init, headers: filterCrossOriginStreamHeaders(init.headers) };
          }
          target = next.toString();
        } catch {
          return { kind: "response", response, finalUrl: target };
        }
        continue;
      }
    }
    return { kind: "response", response, finalUrl: target };
  }
}

const CROSS_ORIGIN_STREAM_HEADERS = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "user-agent",
  "range",
  "if-range",
]);

/** Only transport hints cross resource origins; unknown fields may be credentials. */
export function filterCrossOriginStreamHeaders(headers: RequestInit["headers"]): Headers {
  const filtered = new Headers();
  new Headers(headers).forEach((value, name) => {
    if (CROSS_ORIGIN_STREAM_HEADERS.has(name)) filtered.set(name, value);
  });
  return filtered;
}

/**
 * The same target guard for fetches that are not reachability probes — the
 * HLS ladder expands a provider-supplied master URL before the resolve gate
 * sees its variants, so it borrows the blocklist and per-hop redirect checks.
 * DNS answers are validated only when the impl is the platform `fetch`
 * captured at module load; a stubbed or injected impl owns its destinations.
 * A relay port resolves on the relay's side, where local answers mean nothing.
 */
export function fetchGuardedStreamTarget(options: {
  readonly fetchImpl: StreamReachabilityFetch;
  readonly url: string;
  readonly init: RequestInit;
  readonly signal?: AbortSignal;
  readonly resolvesLocally?: (url: string) => boolean;
}): Promise<ProbeFetchOutcome> {
  return fetchProbeTarget({
    fetchImpl: options.fetchImpl,
    url: options.url,
    init: { ...options.init, signal: options.signal },
    remaining: () => 1,
    parentSignal: options.signal,
    resolveNamesFor: options.resolvesLocally ?? (() => isGuardedPlatformFetch(options.fetchImpl)),
  });
}
