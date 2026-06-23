import type { ProviderRelayConfig } from "@kunai/types";

import { normalizeRelayBaseUrl } from "./normalize-relay-base-url";

export interface ProviderRelayEnvOverrides {
  readonly baseUrl?: string;
  readonly token?: string;
}

export interface EffectiveProviderRelayConfig extends ProviderRelayConfig {
  readonly active: boolean;
}

export function resolveEffectiveProviderRelayConfig(
  config: ProviderRelayConfig | undefined,
  env: ProviderRelayEnvOverrides = {},
): EffectiveProviderRelayConfig {
  const relay = config ?? {};
  const baseUrl = normalizeRelayBaseUrl(env.baseUrl?.trim() || relay.baseUrl);
  const token = env.token?.trim() || relay.token?.trim() || undefined;
  const enabled = relay.enabled !== false;
  const active = enabled && Boolean(baseUrl);

  return {
    baseUrl: active ? baseUrl : undefined,
    token,
    enabled,
    fallbackToDirect: relay.fallbackToDirect !== false,
    providers: relay.providers ?? {},
    active,
  };
}

export function isProviderRelayEnabledForProvider(
  config: ProviderRelayConfig | undefined,
  providerId: string,
): boolean {
  if (!config) return true;
  return config.providers?.[providerId]?.enabled !== false;
}
