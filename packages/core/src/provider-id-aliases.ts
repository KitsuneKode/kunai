import type { ProviderId } from "@kunai/types";

const LEGACY_PROVIDER_ALIASES: Readonly<Record<string, ProviderId>> = {
  vidking: "videasy",
};

/** Canonical provider id for runtime routing (legacy aliases folded). */
export function resolveProviderIdAlias(providerId: string): ProviderId {
  return (LEGACY_PROVIDER_ALIASES[providerId] ?? providerId) as ProviderId;
}

export function isVideasyFamilyProvider(providerId: string): boolean {
  return resolveProviderIdAlias(providerId) === "videasy";
}
