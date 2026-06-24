import type { ProviderRelayConfig } from "@kunai/types";

import { DEFAULT_CONFIG } from "./defaults";
import { kitsuneConfigPartialSchema, kitsuneProviderRelayConfigSchema } from "./schema";
import type { KitsuneConfig } from "./types";

export function parseProviderRelayConfig(value: unknown): ProviderRelayConfig {
  const parsed = kitsuneProviderRelayConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_CONFIG.providerRelay;
}

export function parseKitsuneConfigPartial(value: unknown): Partial<KitsuneConfig> {
  const parsed = kitsuneConfigPartialSchema.safeParse(value);
  if (!parsed.success) return {};
  return parsed.data as Partial<KitsuneConfig>;
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
