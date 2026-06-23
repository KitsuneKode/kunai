import { expect, test } from "bun:test";

import { applySettingsInlineToggle } from "@/app-shell/settings-inline-toggles";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  describeProviderRelayEnabled,
  describeProviderRelayFallback,
} from "@/services/providers/provider-relay-settings";

const baseDraft = {
  providerRelay: {
    enabled: true,
    baseUrl: "",
    token: "",
    fallbackToDirect: true,
    providers: {},
  },
} as Pick<KitsuneConfig, "providerRelay"> as KitsuneConfig;

test("applySettingsInlineToggle flips providerRelayEnabled without a configured URL", () => {
  const disabled = applySettingsInlineToggle(baseDraft, "providerRelayEnabled");
  expect(disabled?.providerRelay.enabled).toBe(false);
  const enabled = applySettingsInlineToggle(disabled!, "providerRelayEnabled");
  expect(enabled?.providerRelay.enabled).toBe(true);
});

test("describeProviderRelayEnabled reflects toggle state even without URL", () => {
  expect(describeProviderRelayEnabled(baseDraft)).toBe("on");
  expect(
    describeProviderRelayEnabled({
      ...baseDraft,
      providerRelay: { ...baseDraft.providerRelay, enabled: false },
    }),
  ).toBe("off");
});

test("describeProviderRelayFallback uses on/off switch labels", () => {
  expect(describeProviderRelayFallback(baseDraft)).toBe("on");
  expect(
    describeProviderRelayFallback({
      ...baseDraft,
      providerRelay: { ...baseDraft.providerRelay, fallbackToDirect: false },
    }),
  ).toBe("off");
});
