import {
  describeProviderRelayProviders,
  describeRelaySectionSummary,
  isLikelyRelayToken,
  isSafeProviderRelayBaseUrl,
  RELAY_CAPABLE_PROVIDER_OPTIONS,
  toggleProviderRelayProvider,
  type RelayCapableProviderId,
} from "@/domain/provider-relay-settings";

import type { SettingRowDef, SettingsRegistryContext } from "../types";

export function relaySettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    ...providerDnsSettingsRows(),
    {
      kind: "subheading",
      id: "subheading:relay",
      label: "Provider relay",
      detail: "User-owned RPC relay for geo-blocked provider metadata; playback stays direct",
      configKeys: ["providerRelay"],
    },
    {
      kind: "boolean",
      id: "providerRelayEnabled",
      effectTiming: "next-playback",
      configKeys: ["providerRelay"],
      label: "Relay enabled",
      detail:
        "Master switch — off uses direct provider fetches even when a relay URL is configured",
      read: (config) => config.providerRelay.enabled !== false,
      write: (config, value) => ({
        ...config,
        providerRelay: { ...config.providerRelay, enabled: value },
      }),
    },
    {
      kind: "text",
      id: "providerRelayBaseUrl",
      effectTiming: "next-playback",
      configKeys: ["providerRelay"],
      label: "Relay server URL",
      detail: "https:// user-owned relay endpoint, or local http://127.0.0.1 for dev",
      placeholder: "Type your relay server URL, then press Enter",
      envOverride: "KUNAI_RELAY_BASE_URL",
      read: (config) => config.providerRelay.baseUrl?.trim() ?? "",
      apply: (config, value) => ({
        ...config,
        providerRelay: {
          ...config.providerRelay,
          baseUrl: value.trim(),
          ...(config.providerRelay.baseUrl?.trim() ? null : { enabled: true }),
        },
      }),
      validate: (value) =>
        !value.trim() || isSafeProviderRelayBaseUrl(value.trim())
          ? null
          : "Type a safe https:// relay URL or local http://127.0.0.1 URL.",
    },
    {
      kind: "text",
      id: "providerRelayToken",
      effectTiming: "next-playback",
      configKeys: ["providerRelay"],
      label: "Relay token",
      detail: "Bearer token when your relay requires authentication",
      placeholder: "Type your relay bearer token, then press Enter",
      envOverride: "KUNAI_RELAY_TOKEN",
      sensitive: true,
      read: (config) => config.providerRelay.token?.trim() ?? "",
      apply: (config, value) => ({
        ...config,
        providerRelay: { ...config.providerRelay, token: value.trim() },
      }),
      validate: (value) =>
        !value.trim() || isLikelyRelayToken(value.trim())
          ? null
          : "Type a relay bearer token, or clear to unset.",
    },
    {
      kind: "boolean",
      id: "providerRelayFallbackToDirect",
      effectTiming: "next-playback",
      configKeys: ["providerRelay"],
      label: "Relay fallback",
      detail: "On: retry direct fetch when relay RPC fails. Off: fail the resolve instead",
      read: (config) => config.providerRelay.fallbackToDirect !== false,
      write: (config, value) => ({
        ...config,
        providerRelay: { ...config.providerRelay, fallbackToDirect: value },
      }),
    },
    {
      kind: "submenu",
      id: "providerRelayProviders",
      effectTiming: "next-playback",
      configKeys: ["providerRelay"],
      label: "Relay providers",
      detail: "Choose which relay-capable providers route metadata through your relay",
      summarize: (config) => describeProviderRelayProviders(config),
      buildChoices: (choiceCtx) =>
        RELAY_CAPABLE_PROVIDER_OPTIONS.map((option) => {
          const enabled =
            choiceCtx.config.providerRelay.providers?.[option.value]?.enabled !== false;
          return {
            value: option.value,
            label: `${option.label}  ·  ${enabled ? "relay" : "direct"}`,
            detail: enabled
              ? "Metadata requests route through your relay when relay is active"
              : "Always use direct fetch for this provider",
          };
        }),
      onPick: (config, value) => ({
        next: {
          ...config,
          providerRelay: toggleProviderRelayProvider(config, value as RelayCapableProviderId),
        },
        stay: true,
      }),
    },
    {
      kind: "status",
      id: "providerRelayStatus",
      label: "Relay status",
      detail: describeRelaySectionSummary(ctx.config),
      tone: "info",
    },
  ];
}

/** Settings › Sources › Provider lookups. Needs no context: it reads only config. */
export function providerDnsSettingsRows(): SettingRowDef[] {
  return [
    {
      kind: "subheading",
      id: "subheading:provider-dns",
      label: "Provider lookups",
      detail: "How Kunai finds provider sites when your network's DNS blocks them",
      configKeys: ["providerDns"],
    },
    {
      kind: "boolean",
      id: "providerDns",
      effectTiming: "next-launch",
      configKeys: ["providerDns"],
      label: "DNS-over-HTTPS",
      detail:
        "On: provider site names are looked up through Cloudflare (1.1.1.1), falling back to your system DNS. Off: system DNS only. Video always uses system DNS",
      envOverride: "KUNAI_DOH_DISABLE",
      read: (config) => config.providerDns !== "system",
      write: (config, value) => ({ ...config, providerDns: value ? "doh" : "system" }),
    },
  ];
}
