import { expect, test } from "bun:test";

import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  describeProviderRelay,
  describeProviderRelayEnabled,
  describeProviderRelayProviders,
  isSafeProviderRelayBaseUrl,
  toggleProviderRelayProvider,
} from "@/services/providers/provider-relay-settings";

const baseConfig = {
  providerRelay: {
    enabled: true,
    baseUrl: "https://relay.example",
    token: "secret",
    fallbackToDirect: true,
    providers: {},
  },
} as Pick<KitsuneConfig, "providerRelay"> as KitsuneConfig;

test("describeProviderRelayEnabled reflects master switch", () => {
  expect(
    describeProviderRelayEnabled({
      ...baseConfig,
      providerRelay: { ...baseConfig.providerRelay, baseUrl: "", enabled: true },
    }),
  ).toBe("on");
  expect(
    describeProviderRelayEnabled({
      ...baseConfig,
      providerRelay: { ...baseConfig.providerRelay, enabled: false },
    }),
  ).toBe("off");
});

test("describeProviderRelay summarizes effective routing", () => {
  expect(
    describeProviderRelay({
      ...baseConfig,
      providerRelay: { ...baseConfig.providerRelay, baseUrl: "", enabled: true },
    }),
  ).toBe("on · no url");
  expect(
    describeProviderRelay({
      ...baseConfig,
      providerRelay: { ...baseConfig.providerRelay, enabled: false },
    }),
  ).toBe("disabled");
  expect(describeProviderRelay(baseConfig)).toBe("on");
});

test("toggleProviderRelayProvider flips per-provider routing", () => {
  const toggled = toggleProviderRelayProvider(baseConfig, "allanime");
  expect(toggled.providers?.allanime?.enabled).toBe(false);
  const restored = toggleProviderRelayProvider(
    { ...baseConfig, providerRelay: toggled },
    "allanime",
  );
  expect(restored.providers?.allanime?.enabled).toBe(true);
});

test("describeProviderRelayProviders counts direct overrides", () => {
  const config = {
    ...baseConfig,
    providerRelay: {
      ...baseConfig.providerRelay,
      providers: { allanime: { enabled: false }, miruro: { enabled: false } },
    },
  };
  expect(describeProviderRelayProviders(config)).toBe("3 on · 2 direct");
});

test("isSafeProviderRelayBaseUrl accepts https and local http only", () => {
  expect(isSafeProviderRelayBaseUrl("https://relay.example")).toBe(true);
  expect(isSafeProviderRelayBaseUrl("http://127.0.0.1:8787")).toBe(true);
  expect(isSafeProviderRelayBaseUrl("http://relay.example")).toBe(false);
});
