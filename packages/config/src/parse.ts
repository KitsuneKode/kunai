import type { ProviderRelayConfig } from "@kunai/types";
import { isJsonObject } from "@kunai/types";

import { DEFAULT_CONFIG } from "./defaults";
import { kitsuneProviderRelayConfigSchema } from "./schema";
import type { KitsuneConfig } from "./types";

export function parseProviderRelayConfig(value: unknown): ProviderRelayConfig {
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONFIG.providerRelay;
}

export function parseKitsuneConfigPartial<T>(value: T): Partial<KitsuneConfig> {
  if (!isJsonObject(value)) return {};
  // providerRelay is the only schema-checked field; a bad value there must
  // not poison every other key. Validate it apart from the passthrough rest.
  // SAFETY: untyped keys pass through for forward compatibility exactly as
  // kitsuneConfigPartialSchema defined them; providerRelay is re-validated
  // below before it can reach the result.
  const { providerRelay, ...rest } = value as Partial<KitsuneConfig>;
  if (providerRelay === undefined) return rest;
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(providerRelay);
  return parsed.success ? { ...rest, providerRelay: parsed.data } : rest;
}

export function mergeKitsuneConfig(
  base: KitsuneConfig,
  partial: Partial<KitsuneConfig>,
): KitsuneConfig {
  return {
    ...base,
    ...partial,
    ...(partial.providerRelay !== undefined
      ? { providerRelay: parseProviderRelayConfig(partial.providerRelay) }
      : null),
  };
}
