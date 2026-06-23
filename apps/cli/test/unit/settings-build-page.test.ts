import { expect, test } from "bun:test";

import { buildSettingsPage } from "@/app-shell/settings/build-page";
import { buildSettingsRegistry } from "@/app-shell/settings/registry";
import type { Container } from "@/container";
import { CONFIG_METADATA } from "@/services/persistence/config-metadata";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";

test("buildSettingsRegistry includes relay text rows without keep/clear submenu", () => {
  const config = {
    ...DEFAULT_CONFIG,
    providerRelay: { ...DEFAULT_CONFIG.providerRelay, enabled: true, baseUrl: "", token: "" },
  } satisfies KitsuneConfig;
  const ctx = {
    config,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    container: {} as Container,
  };
  const rows = buildSettingsRegistry(ctx);
  const relayUrl = rows.find((row) => row.id === "providerRelayBaseUrl");
  const relayToken = rows.find((row) => row.id === "providerRelayToken");
  expect(relayUrl?.kind).toBe("text");
  expect(relayToken?.kind).toBe("text");
});

test("buildSettingsPage filters rows by search query", () => {
  const config = DEFAULT_CONFIG;
  const ctx = {
    config,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    container: {} as Container,
  };
  const page = buildSettingsPage(ctx, { searchQuery: "relay" });
  expect(page.rows.some((row) => row.def.id === "providerRelayBaseUrl")).toBe(true);
  expect(page.rows.some((row) => row.def.id === "footerHints")).toBe(false);
});

test("editable config metadata is represented by registry rows", () => {
  const ctx = {
    config: DEFAULT_CONFIG,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    container: {} as Container,
  };
  const rows = buildSettingsRegistry(ctx);

  const coveredKeys = new Set<string>();
  for (const row of rows) {
    coveredKeys.add(row.id);
    for (const key of row.configKeys ?? []) {
      coveredKeys.add(key);
    }
  }

  const missing = CONFIG_METADATA.filter((entry) => entry.editable).flatMap((entry) =>
    coveredKeys.has(entry.key) ? [] : [entry.key],
  );

  expect(missing).toEqual([]);
});
