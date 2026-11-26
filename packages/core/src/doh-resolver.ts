/**
 * DNS-over-HTTPS for provider metadata traffic.
 *
 * ISP resolvers in several regions sinkhole provider frontends and APIs; a
 * poisoned connection hangs into the caller's own timeout instead of failing,
 * so "fall back on error" never fires in time. Resolving those names through
 * DoH sidesteps the poisoned answer.
 *
 * The resolver never makes a request slower than system DNS by more than one
 * bounded query: answers are cached for their TTL, and a breaker stops asking
 * for a cooldown once DoH itself is
 * unreachable (a network that blocks 1.1.1.1). `null` always means "use
 * system DNS", so every failure mode degrades to the old behaviour.
 *
 * Only metadata goes this way. Media URLs are probed with system DNS because
 * the player resolves them with system DNS; see `ProviderFetchPort.probeFetch`.
 */

export type ProviderDnsMode = "doh" | "system";

export interface DohAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface DohResolverStats {
  readonly mode: "doh";
  readonly answered: number;
  readonly systemFallbacks: number;
  readonly breakerOpenUntil?: number;
  readonly lastFailure?: string;
}

export interface DohResolver {
  /** DoH answers for `hostname`, or `null` when the caller should use system DNS. */
  resolve(hostname: string, signal?: AbortSignal): Promise<readonly DohAddress[] | null>;
  stats(): DohResolverStats;
}

export type DohFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface DohResolverOptions {
  readonly fetch?: DohFetch;
  /** Tried in order; IP literals so the resolver itself needs no DNS. */
  readonly endpoints?: readonly string[];
  readonly queryTimeoutMs?: number;
  readonly now?: () => number;
  /** Consecutive unreachable lookups before the breaker opens. */
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
  readonly maxEntries?: number;
  readonly onBreakerOpen?: (reason: string) => void;
  /** Test seam: the per-query deadline. Defaults to `AbortSignal.timeout`. */
  readonly timeoutSignal?: (ms: number) => AbortSignal;
}

export const DEFAULT_DOH_ENDPOINTS: readonly string[] = [
  "https://1.1.1.1/dns-query",
  "https://1.0.0.1/dns-query",
];

const DEFAULT_QUERY_TIMEOUT_MS = 1500;
const DEFAULT_FAILURE_THRESHOLD = 2;
const DEFAULT_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_MAX_ENTRIES = 512;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 10 * 60_000;
/** NXDOMAIN or an empty answer: let system DNS try (split-horizon names), briefly. */
const NEGATIVE_TTL_MS = 60_000;

const RECORD_A = 1;
const RECORD_AAAA = 28;

type CacheEntry = { readonly addresses: readonly DohAddress[] | null; readonly expiresAt: number };

type QueryOutcome =
  | { readonly kind: "answer"; readonly addresses: readonly DohAddress[]; readonly ttlMs: number }
  | { readonly kind: "unreachable"; readonly reason: string };

/**
 * Names that must never leave the machine for resolution: IP literals, the
 * loopback name, single-label hosts, and the private-use suffixes. A
 * self-hosted addon on `nas.lan` resolves through the system as it always has.
 */
export function shouldBypassDoh(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!host) return true;
  if (isIpLiteral(host)) return true;
  if (!host.includes(".")) return true;
  return (
    host === "localhost" ||
    [".localhost", ".local", ".lan", ".home", ".home.arpa", ".internal", ".intranet", ".corp"].some(
      (suffix) => host.endsWith(suffix),
    )
  );
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * An explicit HTTP(S) proxy owns name resolution for the requests it carries;
 * dialing a resolved address directly would bypass it.
 */
export function proxyAppliesTo(
  url: URL,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const pick = (...names: string[]) =>
    names.map((name) => env[name]?.trim()).find((value) => Boolean(value));
  const proxy =
    url.protocol === "https:"
      ? pick("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")
      : pick("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy");
  if (!proxy) return false;
  const noProxy = pick("NO_PROXY", "no_proxy");
  if (!noProxy) return true;
  const host = url.hostname.toLowerCase();
  return !noProxy.split(",").some((raw) => {
    const entry = raw.trim().toLowerCase().replace(/:\d+$/, "");
    if (!entry) return false;
    if (entry === "*") return true;
    const bare = entry.replace(/^\*?\./, "");
    return host === bare || host.endsWith(`.${bare}`);
  });
}

export function createDohResolver(options: DohResolverOptions = {}): DohResolver {
  const fetchImpl: DohFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoints = options.endpoints?.length ? options.endpoints : DEFAULT_DOH_ENDPOINTS;
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const timeoutSignal = options.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));

  const cache = new Map<string, CacheEntry>();
  let consecutiveFailures = 0;
  let breakerOpenUntil = 0;
  let answered = 0;
  let systemFallbacks = 0;
  let lastFailure: string | undefined;

  const remember = (host: string, addresses: readonly DohAddress[] | null, ttlMs: number) => {
    if (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(host, { addresses, expiresAt: now() + ttlMs });
  };

  const queryOne = async (
    endpoint: string,
    host: string,
    type: number,
    signal: AbortSignal | undefined,
  ): Promise<QueryOutcome> => {
    const timeout = timeoutSignal(queryTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetchImpl(
        `${endpoint}?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: combined },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: "unreachable", reason: `HTTP ${response.status}` };
      }
      const body = parseDohJson(await response.text());
      return parseAnswer(body, type);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      return {
        kind: "unreachable",
        reason: timeout.aborted ? "timeout" : error instanceof Error ? error.name : "error",
      };
    }
  };

  const queryType = async (host: string, type: number, signal?: AbortSignal) => {
    let last: QueryOutcome = { kind: "unreachable", reason: "no endpoint" };
    for (const endpoint of endpoints) {
      last = await queryOne(endpoint, host, type, signal);
      if (last.kind === "answer") return last;
    }
    return last;
  };

  const lookup = async (host: string, signal?: AbortSignal) => {
    const [v4, v6] = await Promise.all([
      queryType(host, RECORD_A, signal),
      queryType(host, RECORD_AAAA, signal),
    ]);
    if (v4.kind === "unreachable" && v6.kind === "unreachable") {
      consecutiveFailures += 1;
      lastFailure = v4.reason;
      systemFallbacks += 1;
      if (consecutiveFailures >= failureThreshold) {
        breakerOpenUntil = now() + cooldownMs;
        options.onBreakerOpen?.(v4.reason);
      }
      return null;
    }
    consecutiveFailures = 0;
    // v4 first: these CDNs are reliably reachable over v4, v6 only sometimes.
    const preferred = v4.kind === "answer" && v4.addresses.length > 0 ? v4 : v6;
    if (preferred.kind !== "answer" || preferred.addresses.length === 0) {
      remember(host, null, NEGATIVE_TTL_MS);
      systemFallbacks += 1;
      return null;
    }
    remember(host, preferred.addresses, preferred.ttlMs);
    answered += 1;
    return preferred.addresses;
  };

  return {
    async resolve(hostname, signal) {
      const host = hostname.toLowerCase().replace(/\.$/, "");
      if (shouldBypassDoh(host)) return null;
      const cached = cache.get(host);
      if (cached && cached.expiresAt > now()) return cached.addresses;
      if (cached) cache.delete(host);
      if (breakerOpenUntil > now()) {
        systemFallbacks += 1;
        return null;
      }
      // Concurrent lookups are joined by the caller (the CLI's keyed joiner);
      // this resolver only caches settled answers.
      return lookup(host, signal);
    },
    stats() {
      return {
        mode: "doh",
        answered,
        systemFallbacks,
        breakerOpenUntil: breakerOpenUntil > now() ? breakerOpenUntil : undefined,
        lastFailure,
      };
    },
  };
}

/** The JSON shape of RFC 8427-style DoH answers (Cloudflare `application/dns-json`). */
type DohJsonBody = {
  readonly Status?: number;
  readonly Answer?: readonly {
    readonly type?: number;
    readonly data?: string;
    readonly TTL?: number;
  }[];
};

/** The I/O boundary: text in, the expected shape or `null` out. */
function parseDohJson(text: string): DohJsonBody | null {
  try {
    const parsed: DohJsonBody | null = JSON.parse(text);
    return parsed && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_LITERAL = /^[0-9a-f:.]+$/i;

/**
 * Validate a DoH answer. The body is untrusted: only records of the asked
 * type whose data is an address literal of that family survive, and the
 * transport re-checks every address before dialling.
 */
function parseAnswer(body: DohJsonBody | null, type: number): QueryOutcome {
  if (!body) return { kind: "unreachable", reason: "bad-json" };
  // 0 NOERROR, 3 NXDOMAIN: both are real answers. Anything else (SERVFAIL,
  // REFUSED) says the resolver could not help, which is not "no such name".
  if (body.Status !== 0 && body.Status !== 3) {
    return { kind: "unreachable", reason: `rcode ${String(body.Status)}` };
  }
  const family = type === RECORD_A ? 4 : 6;
  const literal = family === 4 ? IPV4_LITERAL : IPV6_LITERAL;
  const matching = (Array.isArray(body.Answer) ? body.Answer : []).filter(
    (answer) => answer.type === type && literal.test(String(answer.data ?? "")),
  );
  const ttls = matching.map((answer) => (Number.isFinite(answer.TTL) ? Number(answer.TTL) : 0));
  const ttlMs = Math.min(
    MAX_TTL_MS,
    Math.max(MIN_TTL_MS, Math.min(...ttls, MAX_TTL_MS / 1000) * 1000),
  );
  return {
    kind: "answer",
    ttlMs,
    addresses: matching.map((answer) => ({ address: String(answer.data), family })),
  };
}

let activeResolver: DohResolver | null = null;

/**
 * The process-wide resolver, set once by the composition root from the user's
 * `providerDns` setting. Subprocess fetchers (curl-impersonate) read it, so
 * they share the same cache and breaker as the fetch port.
 */
export function setProviderDohResolver(resolver: DohResolver | null): void {
  activeResolver = resolver;
}

export function getProviderDohResolver(): DohResolver | null {
  return activeResolver;
}
