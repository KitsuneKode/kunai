import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  isProviderRelayEnabledForProvider,
  resolveEffectiveProviderRelayConfig,
} from "@kunai/relay";

export const RELAY_CAPABLE_PROVIDER_OPTIONS = [
  { value: "allanime", label: "AllAnime" },
  { value: "miruro", label: "Miruro" },
  { value: "videasy", label: "Videasy" },
  { value: "vidlink", label: "VidLink" },
  { value: "rivestream", label: "Rivestream" },
] as const;

export type RelayCapableProviderId = (typeof RELAY_CAPABLE_PROVIDER_OPTIONS)[number]["value"];

export function resolveEffectiveRelayFromConfig(config: KitsuneConfig) {
  return resolveEffectiveProviderRelayConfig(config.providerRelay, {
    baseUrl: process.env.KUNAI_RELAY_BASE_URL,
    token: process.env.KUNAI_RELAY_TOKEN,
  });
}

export function describeProviderRelayEnabled(config: KitsuneConfig): string {
  const relay = config.providerRelay;
  const envUrl = process.env.KUNAI_RELAY_BASE_URL?.trim();
  const enabled = relay.enabled !== false;
  if (envUrl) return enabled ? "env · on" : "env · off";
  return enabled ? "on" : "off";
}

export function describeProviderRelay(config: KitsuneConfig): string {
  const enabled = config.providerRelay.enabled !== false;
  if (!enabled) return "disabled";
  const effective = resolveEffectiveRelayFromConfig(config);
  if (!effective.baseUrl) return "on · no url";
  if (process.env.KUNAI_RELAY_BASE_URL?.trim()) return "env · on";
  return "on";
}

export function describeProviderRelayFallback(config: KitsuneConfig): string {
  return config.providerRelay.fallbackToDirect === false ? "off" : "on";
}

export function describeProviderRelayUrl(config: KitsuneConfig): string {
  const effective = resolveEffectiveRelayFromConfig(config);
  if (!effective.baseUrl) return "not set";
  try {
    const host = new URL(effective.baseUrl).host;
    return host;
  } catch {
    return "configured";
  }
}

export function describeProviderRelayToken(config: KitsuneConfig): string {
  if (process.env.KUNAI_RELAY_TOKEN?.trim()) return "env";
  const token = config.providerRelay.token?.trim();
  if (!token) return "missing";
  return "configured";
}

export function describeProviderRelayProviders(config: KitsuneConfig): string {
  const relay = config.providerRelay;
  const disabled = RELAY_CAPABLE_PROVIDER_OPTIONS.filter(
    (option) => !isProviderRelayEnabledForProvider(relay, option.value),
  ).length;
  if (disabled === 0) return "all relay-capable";
  const enabled = RELAY_CAPABLE_PROVIDER_OPTIONS.length - disabled;
  return `${enabled} on · ${disabled} direct`;
}

export function describeRelaySectionSummary(config: KitsuneConfig): string {
  return `${describeProviderRelayEnabled(config)}  ·  ${describeProviderRelayUrl(config)}  ·  token ${describeProviderRelayToken(config)}`;
}

export function isSafeProviderRelayBaseUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"))
    );
  } catch {
    return false;
  }
}

export function isLikelyRelayToken(value: string): boolean {
  return value.length >= 8 && !/\s/.test(value);
}

export function toggleProviderRelayProvider(
  config: KitsuneConfig,
  providerId: RelayCapableProviderId,
): KitsuneConfig["providerRelay"] {
  const relay = config.providerRelay;
  const currentlyEnabled = isProviderRelayEnabledForProvider(relay, providerId);
  const providers = { ...relay.providers };
  providers[providerId] = { ...providers[providerId], enabled: !currentlyEnabled };
  return { ...relay, providers };
}

export function setProviderRelayEnabled(
  relay: KitsuneConfig["providerRelay"],
  enabled: boolean,
): KitsuneConfig["providerRelay"] {
  return { ...relay, enabled };
}

export function setProviderRelayFallbackToDirect(
  relay: KitsuneConfig["providerRelay"],
  fallbackToDirect: boolean,
): KitsuneConfig["providerRelay"] {
  return { ...relay, fallbackToDirect };
}
