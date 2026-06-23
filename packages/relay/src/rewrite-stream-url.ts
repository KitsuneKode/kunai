import type { ProviderRelayConfig, ProviderRelayRegistry } from "./types";

export function rewriteStreamUrlForRelay(input: {
  readonly url: string;
  readonly providerId: string;
  readonly relayConfig: ProviderRelayConfig | undefined;
  readonly registry: ProviderRelayRegistry;
}): string {
  const baseUrl = input.relayConfig?.baseUrl?.trim();
  if (!baseUrl) return input.url;

  const providerConfig = input.relayConfig?.providers?.[input.providerId];
  if (providerConfig?.videoFallback !== true) return input.url;
  if (!input.registry.isHostAllowed(input.providerId, input.url, "media")) return input.url;

  const relayUrl = new URL(`/stream/${input.providerId}`, baseUrl);
  relayUrl.searchParams.set("u", input.url);
  return relayUrl.toString();
}
