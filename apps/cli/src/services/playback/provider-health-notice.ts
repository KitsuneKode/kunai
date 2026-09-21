import type { ProviderHealth } from "@kunai/types";

import { resolveEffectiveProviderHealth } from "./provider-health-policy";

/**
 * Decides whether the configured default provider is persistently broken and
 * which provider to point the user at instead.
 *
 * `down` (not merely `degraded`) is the bar on purpose: degraded means the
 * provider is still resolving some of the time, and a notice there would nag
 * during ordinary flakiness. A down provider returns nothing, so the notice is
 * the difference between a user debugging their network and a user picking a
 * working provider.
 *
 * The suggestion prefers the user's own provider order (they chose it), then
 * any loaded provider that is not down. It deliberately does not sort by
 * median latency: the notice answers "what should I try instead", and the
 * ordering the user already configured is the honest suggestion.
 */
export function providerHealthNotice(input: {
  readonly configuredProvider: string;
  readonly providerPriority: readonly string[];
  readonly loadedProviders: readonly string[];
  readonly healthRows: readonly ProviderHealth[];
  readonly now?: Date;
}): { readonly downProviderId: string; readonly suggestedProviderId: string | null } | null {
  const now = input.now ?? new Date();
  const rowFor = (providerId: string) =>
    input.healthRows.find((row) => row.providerId === providerId);
  const isDown = (providerId: string) =>
    resolveEffectiveProviderHealth(rowFor(providerId), now)?.effectiveStatus === "down";

  if (!isDown(input.configuredProvider)) return null;

  const suggested =
    input.providerPriority.find(
      (providerId) =>
        providerId !== input.configuredProvider &&
        input.loadedProviders.includes(providerId) &&
        !isDown(providerId),
    ) ??
    input.loadedProviders.find(
      (providerId) => providerId !== input.configuredProvider && !isDown(providerId),
    ) ??
    null;

  return { downProviderId: input.configuredProvider, suggestedProviderId: suggested };
}
