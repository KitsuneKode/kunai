/**
 * Provider-supplied URLs are untrusted input: a page or playlist can name a
 * loopback, link-local, or LAN target and a downstream fetch would otherwise
 * reach it — a server-side request forgery by a site's own markup. Nothing a
 * provider offers should ever be private, so the gate is simple: http(s) only,
 * public literal hosts only, and (on the real fetch path) DNS answers checked
 * too.
 *
 * `blockedLiteralTargetReason` is the synchronous half — scheme, host shape,
 * and literal ranges, no DNS — so an injected fetch sees no extra microtask.
 * `resolvedAddressBlockReason` adds DNS answer validation for the real path.
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
  // A single-label name is an intranet name; public DNS names always carry a dot.
  if (!host.includes(".") && !host.includes(":")) {
    return `single-label host ${host}`;
  }
  return null;
}

export async function resolvedAddressBlockReason(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const resolved = await resolveHostAddresses(host, signal);
  for (const address of resolved) {
    const reason = isPrivateLiteralAddress(address);
    if (reason) return `${reason} (DNS answer for ${host})`;
  }
  return null;
}

/** Dotted-quad parse; WHATWG URL canonicalises exotic forms before we see them. */
export function parseIpv4(host: string): [number, number, number, number] | null {
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
  const c = parts[2];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
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

export function isPrivateLiteralAddress(host: string): string | null {
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

/**
 * A resolver that accepts the query and never answers (UDP drop, captive DNS)
 * would otherwise pend past every caller deadline — the lookup happens inside
 * fetch paths whose advertised budgets assume it returns. Bound it; a dead
 * lookup yields no answers and the fetch fails on its own, same as an
 * unresolvable name.
 */
const DEFAULT_DNS_LOOKUP_BUDGET_MS = 4_000;
let dnsLookupBudgetMs = DEFAULT_DNS_LOOKUP_BUDGET_MS;

/** Test seam — the bound is module state so a test need not wait 4s to see it. */
export function setBlockedTargetDnsBudgetMsForTest(ms: number): void {
  dnsLookupBudgetMs = ms;
}

async function resolveHostAddresses(host: string, signal?: AbortSignal): Promise<string[]> {
  if (parseIpv4(host) || host.includes(":")) return [];
  if (signal?.aborted) return [];
  try {
    const { lookup } = await import("node:dns/promises");
    const answers = await new Promise<{ address: string }[] | null>((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, dnsLookupBudgetMs);
      timer.unref?.();
      const onAbort = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      lookup(host, { all: true }).then(
        (value) => {
          cleanup();
          return resolve(value);
        },
        () => {
          cleanup();
          return resolve(null);
        },
      );
    });
    return (answers ?? []).map((a) => a.address);
  } catch {
    // An unresolvable name fails in the fetch anyway — don't pre-empt its error.
    return [];
  }
}
