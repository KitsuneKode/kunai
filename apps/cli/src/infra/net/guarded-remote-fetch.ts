// =============================================================================
// guarded-remote-fetch.ts — redirect-validating fetch for untrusted remote refs
//
// Poster and artwork URLs are provider-controlled strings that end up fetched
// from this process. A bare fetch() follows redirects into private address
// space — one 302 and the resolver is reading an internal host, or worse,
// fingerprinting one. These hops are validated the same way stream targets
// are: literal ranges and DNS answers on every hop, never just the first URL.
// =============================================================================

import { blockedLiteralTargetReason, resolvedAddressBlockReason } from "@kunai/types";

export type GuardedRemoteFetchOptions = {
  readonly fetchImpl?: typeof fetch;
  /** Require `https:` on every hop — the shape catalog admission enforces. */
  readonly httpsOnly?: boolean;
  /** Redirect hop ceiling. Mirrors the stream-reachability policy. */
  readonly maxHops?: number;
};

export class GuardedRemoteFetchError extends Error {
  readonly target: string;
  constructor(message: string, target: string) {
    super(message);
    this.name = "GuardedRemoteFetchError";
    this.target = target;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = ["authorization", "cookie", "proxy-authorization", "referer", "origin"];

// The load-time binding marks "the platform fetch": DNS revalidation below
// applies only when the impl in use IS that platform fetch. Tests that patch
// `globalThis.fetch` (or callers injecting `fetchImpl`) get their impl honored
// and the DNS pass skipped — a stubbed lookup is pure flakiness there.
const PLATFORM_FETCH = fetch;

/**
 * Fetch `url` with `redirect: "manual"`, validating each target before it is
 * requested: private literals and private DNS answers are rejected, non-HTTP(S)
 * schemes are rejected, and (with `httpsOnly`) an https hop may not downgrade.
 * Redirects across origins drop the credential/baseline headers — providers
 * never see them here, but the guard stays correct if a caller adds headers.
 */
export async function fetchGuardedRemoteTarget(
  url: string,
  init: RequestInit = {},
  options: GuardedRemoteFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxHops = options.maxHops ?? 4;
  let target = url.trim();
  const headers = new Headers(init.headers);
  let lastOrigin: string | null = null;
  try {
    lastOrigin = new URL(target).origin;
  } catch {
    throw new GuardedRemoteFetchError("Unparseable remote target", target);
  }
  if (options.httpsOnly === true && !target.startsWith("https:")) {
    throw new GuardedRemoteFetchError("Blocked non-https target", target);
  }

  for (let hop = 0; ; hop++) {
    const literalBlocked = blockedLiteralTargetReason(target);
    if (literalBlocked) {
      throw new GuardedRemoteFetchError(`Blocked unsafe target: ${literalBlocked}`, target);
    }
    // DNS answers are validated only for the platform fetch — an injected impl
    // owns its destinations, and a stubbed lookup would be pure test flakiness.
    if (fetchImpl === PLATFORM_FETCH) {
      const resolvedBlocked = await resolvedAddressBlockReason(target);
      if (resolvedBlocked) {
        throw new GuardedRemoteFetchError(`Blocked unsafe target: ${resolvedBlocked}`, target);
      }
    }

    const response = await fetchImpl(target, { ...init, headers, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel("redirected").catch(() => {});
    if (!location || hop >= maxHops) {
      throw new GuardedRemoteFetchError("Redirect chain exceeded", target);
    }

    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      throw new GuardedRemoteFetchError("Blocked unparseable redirect target", target);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new GuardedRemoteFetchError(`Blocked redirect scheme ${next.protocol}`, target);
    }
    const current = new URL(target);
    if (current.protocol === "https:" && next.protocol === "http:") {
      throw new GuardedRemoteFetchError("Blocked https downgrade", target);
    }
    if (options.httpsOnly === true && next.protocol !== "https:") {
      throw new GuardedRemoteFetchError("Blocked non-https target", target);
    }
    if (next.origin !== lastOrigin) {
      // Cross-origin redirect: credentials do not travel with the hop.
      for (const name of SENSITIVE_HEADERS) headers.delete(name);
      lastOrigin = next.origin;
    }
    target = next.href;
  }
}
