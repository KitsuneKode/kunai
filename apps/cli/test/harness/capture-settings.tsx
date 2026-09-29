import { buildSettingsPage } from "@/app-shell/settings/build-page";
import { SettingsOverlay } from "@/app-shell/settings/SettingsOverlay";
import { createSettingsUiState } from "@/app-shell/settings/state";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";
import React from "react";

import { captureSurface } from "./render-capture";

const config = {
  ...DEFAULT_CONFIG,
  providerRelay: {
    ...DEFAULT_CONFIG.providerRelay,
    enabled: true,
    baseUrl: "https://relay.example.com",
    token: "",
    fallbackToDirect: true,
    providers: {},
  },
} satisfies KitsuneConfig;

export const registryCtx = {
  config,
  presenceSnapshot: null,
  seriesProviderOptions: [],
  animeProviderOptions: [],
  youtubeProviderOptions: [],
  sync: {
    adapters: [],
    authAvailability: {
      anilist: {
        available: true as const,
        redirectUri: SHIPPED_ANILIST_REDIRECT_URI,
        clientIdSource: "shipped-default" as const,
      },
      tmdb: { available: true as const, apiKeySource: "shipped-fallback" as const },
    },
    status: {
      connected: 0,
      pending: 0,
      needsReauth: 0,
      deadLettered: 0,
      health: "disconnected" as const,
    },
  },
  container: {} as Container,
};

export const page = buildSettingsPage(registryCtx);
export const mainState = createSettingsUiState(config);
export const inputState = {
  ...createSettingsUiState(config),
  inputMode: {
    active: true as const,
    settingId: "providerRelayBaseUrl",
    seed: "https://relay.example.com",
    buffer: "https://relay-server-two.vercel.app",
  },
  error: null,
};
export const errorState = {
  ...inputState,
  error: "Type a safe https:// relay URL or local http://127.0.0.1 URL.",
};

export function settingsFixtures(): ReadonlyArray<readonly [string, React.ReactElement]> {
  const main = (
    <SettingsOverlay
      page={page}
      state={mainState}
      registryCtx={registryCtx}
      width={100}
      maxRows={14}
      error={null}
    />
  );
  const input = (
    <SettingsOverlay
      page={page}
      state={inputState}
      registryCtx={registryCtx}
      width={100}
      maxRows={14}
      error={null}
    />
  );
  const error = (
    <SettingsOverlay
      page={page}
      state={errorState}
      registryCtx={registryCtx}
      width={100}
      maxRows={14}
      error={errorState.error}
    />
  );
  return [
    ["settings-main", main],
    ["settings-relay-url-input", input],
    ["settings-relay-url-error", error],
  ];
}

if (import.meta.main) {
  for (const [name, node] of settingsFixtures()) {
    await captureSurface(name, node);
  }
  console.log("captured settings overlays");
  process.exit(0);
}
