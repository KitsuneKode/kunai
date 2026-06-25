import { expect, test } from "bun:test";

import { buildSettingsPage, listSettingsSectionLabels } from "@/app-shell/settings/build-page";
import { handleSettingsKey } from "@/app-shell/settings/controller";
import { createSettingsUiState } from "@/app-shell/settings/state";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import type { Key } from "ink";

import { createContainerFixture } from "../support/container-fixture";

function inkKey(partial: Partial<Key>): Key {
  return partial as Key;
}

function baseConfig(): KitsuneConfig {
  return {
    ...DEFAULT_CONFIG,
    providerRelay: {
      ...DEFAULT_CONFIG.providerRelay,
      enabled: true,
      baseUrl: "https://relay.example.com",
      token: "",
    },
  };
}

function mockRegistryCtx(config: KitsuneConfig) {
  const { container } = createContainerFixture();
  return {
    config,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    container,
  };
}

function rowIndexFor(page: ReturnType<typeof buildSettingsPage>, id: string): number {
  return Math.max(
    0,
    page.rows.findIndex((row) => row.def.id === id),
  );
}

test("Enter on relay URL enters dedicated input mode instead of submenu", () => {
  const draft = baseConfig();
  const registryCtx = mockRegistryCtx(draft);
  const relaySectionIndex = listSettingsSectionLabels(registryCtx).indexOf("Provider relay");
  const page = buildSettingsPage(registryCtx, { activeSectionIndex: relaySectionIndex });
  const state = {
    ...createSettingsUiState(draft),
    activeSectionIndex: relaySectionIndex,
    selectedIndex: rowIndexFor(page, "providerRelayBaseUrl"),
  };

  const result = handleSettingsKey("", inkKey({ return: true }), state, {
    container: createContainerFixture().container,
    registryCtx,
  });

  expect(result.handled).toBe(true);
  expect(result.state.inputMode.active).toBe(true);
  if (!result.state.inputMode.active) return;
  expect(result.state.inputMode.settingId).toBe("providerRelayBaseUrl");
  expect(result.state.inputMode.buffer).toBe("https://relay.example.com");
  expect(result.state.submenuId).toBeNull();
});

test("Esc in relay URL input mode restores seed and exits input mode", () => {
  const draft = baseConfig();
  const registryCtx = mockRegistryCtx(draft);
  let state = createSettingsUiState(draft);
  state = {
    ...state,
    inputMode: {
      active: true,
      settingId: "providerRelayBaseUrl",
      seed: "https://relay.example.com",
      buffer: "https://changed.example.com",
    },
  };

  const result = handleSettingsKey("", inkKey({ escape: true }), state, {
    container: createContainerFixture().container,
    registryCtx,
  });

  expect(result.state.inputMode.active).toBe(false);
  expect(result.state.draft.providerRelay.baseUrl).toBe("https://relay.example.com");
});

test("Enter with invalid relay URL keeps input mode and sets error", () => {
  const draft = baseConfig();
  const registryCtx = mockRegistryCtx(draft);
  const state = {
    ...createSettingsUiState(draft),
    inputMode: {
      active: true,
      settingId: "providerRelayBaseUrl",
      seed: "",
      buffer: "http://unsafe.example.com",
    },
  };

  const result = handleSettingsKey("", inkKey({ return: true }), state, {
    container: createContainerFixture().container,
    registryCtx,
  });

  expect(result.state.inputMode.active).toBe(true);
  expect(result.state.error).toContain("safe https://");
});

test("Enter with valid relay URL commits and exits input mode", () => {
  const draft = {
    ...baseConfig(),
    providerRelay: { ...baseConfig().providerRelay, baseUrl: "" },
  };
  const registryCtx = mockRegistryCtx(draft);
  const state = {
    ...createSettingsUiState(draft),
    inputMode: {
      active: true,
      settingId: "providerRelayBaseUrl",
      seed: "",
      buffer: "https://relay-server-two.vercel.app",
    },
  };

  const result = handleSettingsKey("", inkKey({ return: true }), state, {
    container: createContainerFixture().container,
    registryCtx,
  });

  expect(result.state.inputMode.active).toBe(false);
  expect(result.state.draft.providerRelay.baseUrl).toBe("https://relay-server-two.vercel.app");
  expect(result.persist).toBe("immediate");
});

test("pasted text chunks append to relay URL input mode", () => {
  const draft = {
    ...baseConfig(),
    providerRelay: { ...baseConfig().providerRelay, baseUrl: "" },
  };
  const registryCtx = mockRegistryCtx(draft);
  const state = {
    ...createSettingsUiState(draft),
    inputMode: {
      active: true,
      settingId: "providerRelayBaseUrl",
      seed: "",
      buffer: "",
    },
  };

  const result = handleSettingsKey(
    "\u001b[200~https://relay-server-two.vercel.app\u001b[201~",
    inkKey({}),
    state,
    {
      container: createContainerFixture().container,
      registryCtx,
    },
  );

  expect(result.state.inputMode.active).toBe(true);
  if (!result.state.inputMode.active) return;
  expect(result.state.inputMode.buffer).toBe("https://relay-server-two.vercel.app");
});

test("typing on main list before Enter on text row preserves search query when entering input mode", () => {
  const draft = {
    ...baseConfig(),
    providerRelay: { ...baseConfig().providerRelay, baseUrl: "" },
  };
  const registryCtx = mockRegistryCtx(draft);
  const page = buildSettingsPage(registryCtx, { searchQuery: "relay" });
  const state = {
    ...createSettingsUiState(draft),
    searchQuery: "relay",
    selectedIndex: rowIndexFor(page, "providerRelayBaseUrl"),
  };

  const opened = handleSettingsKey("", inkKey({ return: true }), state, {
    container: createContainerFixture().container,
    registryCtx,
  });
  expect(opened.state.inputMode.active).toBe(true);
  if (!opened.state.inputMode.active) return;
  expect(opened.state.searchQuery).toBe("relay");
});

test("Esc on dirty main settings closes without reverting immediate-applied draft", () => {
  const snapshot = baseConfig();
  const draft = {
    ...snapshot,
    showMemory: !snapshot.showMemory,
  };
  const registryCtx = mockRegistryCtx(draft);
  const state = {
    ...createSettingsUiState(snapshot),
    draft,
  };

  const result = handleSettingsKey("", inkKey({ escape: true }), state, {
    container: createContainerFixture().container,
    registryCtx,
  });

  expect(result.handled).toBe(true);
  expect(result.closeOverlay).toBe(true);
  expect(result.state.draft.showMemory).toBe(draft.showMemory);
});
