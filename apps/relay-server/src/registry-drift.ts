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
export function classifyRelayDriftResponse(probe: RelayDriftProbe, body: string): string | null {
  // Only the relay's own error envelope proves drift. An upstream status is
  // forwarded as-is, and these hosts sit behind Cloudflare: probing anidb.app
  // or www.miruro.bz from a datacentre IP answers 403 with a "Just a moment..."
  // challenge, which is the upstream refusing the relay, not the relay missing
  // the provider. Reading a bare status as drift reported a correctly deployed
  // relay as stale. An auth wall in front of the relay is still caught, by the
  // health and unauthorized checks that run before this one.
  if (body.includes("unknown-provider")) {
    return `${probe.providerId} (provider missing from deployment)`;
  }
  if (body.includes("host-not-allowed")) {
    return `${probe.providerId} (rejects ${new URL(probe.url).host})`;
  }
  return null;
}
