import type { ProviderRelayRegistry } from "@kunai/relay";

export type RelayDriftProbe = {
  readonly providerId: string;
  readonly url: string;
};

/**
 * One probe per provider the server actually registers, aimed at that
 * provider's own first allowlisted host.
 *
 * Derived from the registry rather than hand-written: the previous hardcoded
 * list named only the five providers that existed when it was written, so a
 * relay deployed before `anidb` answered `unknown-provider` for it while this
 * check still reported a healthy registry.
 */
export function buildRelayDriftProbes(registry: ProviderRelayRegistry): readonly RelayDriftProbe[] {
  return registry.providers.flatMap((entry) => {
    const host = entry.profile.upstreamHosts[0];
    return host ? [{ providerId: entry.providerId, url: `https://${host}/` }] : [];
  });
}

/**
 * Classify one probe response. A relay that never reached the upstream is
 * stale; anything else is the upstream's own answer and not drift.
 */
export function classifyRelayDriftResponse(
  probe: RelayDriftProbe,
  status: number,
  body: string,
): string | null {
  // Deployment protection (or any auth wall) answers before the relay does, so
  // the body carries no relay error code. Reporting that as a healthy registry
  // is how a stale deployment passes a drift check.
  if (status === 401 || status === 403) {
    if (!body.includes("host-not-allowed") && !body.includes("unauthorized")) {
      return `${probe.providerId} (probe blocked with HTTP ${status}; registry not verified)`;
    }
  }
  if (body.includes("unknown-provider")) {
    return `${probe.providerId} (provider missing from deployment)`;
  }
  if (body.includes("host-not-allowed")) {
    return `${probe.providerId} (rejects ${new URL(probe.url).host})`;
  }
  return null;
}
