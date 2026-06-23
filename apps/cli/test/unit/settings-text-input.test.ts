import { expect, test } from "bun:test";

import { applySettingsTextInput } from "@/app-shell/settings-text-input";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

const baseDraft = {
  providerRelay: {
    enabled: true,
    baseUrl: "",
    token: "",
    fallbackToDirect: true,
    providers: {},
  },
} as Pick<KitsuneConfig, "providerRelay"> as KitsuneConfig;

test("applySettingsTextInput saves relay URL even when keep option would match filter", () => {
  const result = applySettingsTextInput(
    "providerRelayBaseUrl",
    baseDraft,
    "https://relay-server-two.vercel.app",
  );
  expect(result?.ok).toBe(true);
  if (!result?.ok) return;
  expect(result.next.providerRelay.baseUrl).toBe("https://relay-server-two.vercel.app");
  expect(result.next.providerRelay.enabled).toBe(true);
});

test("applySettingsTextInput rejects unsafe relay URLs", () => {
  const result = applySettingsTextInput(
    "providerRelayBaseUrl",
    baseDraft,
    "http://relay.example.com",
  );
  expect(result?.ok).toBe(false);
});
