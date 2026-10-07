import type { ProviderRelayConfig } from "@kunai/types";

import { DEFAULT_CONFIG } from "./defaults";
import { kitsuneProviderRelayConfigSchema } from "./schema";
import type { KitsuneConfig } from "./types";

export function parseProviderRelayConfig(value: unknown): ProviderRelayConfig {
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONFIG.providerRelay;
}

export function parseKitsuneConfigPartial(value: unknown): Partial<KitsuneConfig> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  // providerRelay is the only schema-checked field; a bad value there must
  // not poison every other key. Validate it apart from the passthrough rest.
  const { providerRelay, ...rest } = value as Record<string, unknown>;
  const result: Record<string, unknown> = { ...rest };
  if (providerRelay !== undefined) {
    const parsed = kitsuneProviderRelayConfigSchema.safeParse(providerRelay);
    if (parsed.success) result.providerRelay = parsed.data;
  }
  // SAFETY: the rest is the passthrough boundary — unknown keys survive for
  // forward compatibility exactly as kitsuneConfigPartialSchema defined it.
  return result as Partial<KitsuneConfig>;
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
