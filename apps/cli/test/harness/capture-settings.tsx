import { buildSettingsPage } from "@/app-shell/settings/build-page";
import { SettingsOverlay } from "@/app-shell/settings/SettingsOverlay";
import { createSettingsUiState } from "@/app-shell/settings/state";
import type { Container } from "@/container";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
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

const registryCtx = {
  config,
  presenceSnapshot: null,
  seriesProviderOptions: [],
  animeProviderOptions: [],
  youtubeProviderOptions: [],
  container: {} as Container,
};

const page = buildSettingsPage(registryCtx);
const mainState = createSettingsUiState(config);
const inputState = {
  ...createSettingsUiState(config),
  inputMode: {
    active: true as const,
    settingId: "providerRelayBaseUrl",
    seed: "https://relay.example.com",
    buffer: "https://relay-server-two.vercel.app",
  },
  error: null,
};
const errorState = {
  ...inputState,
  error: "Type a safe https:// relay URL or local http://127.0.0.1 URL.",
};

await captureSurface(
  "settings-main",
  <SettingsOverlay
    page={page}
    state={mainState}
    registryCtx={registryCtx}
    width={100}
    maxRows={14}
    error={null}
  />,
);
await captureSurface(
  "settings-relay-url-input",
  <SettingsOverlay
    page={page}
    state={inputState}
    registryCtx={registryCtx}
    width={100}
    maxRows={14}
    error={null}
  />,
);
await captureSurface(
  "settings-relay-url-error",
  <SettingsOverlay
    page={page}
    state={errorState}
    registryCtx={registryCtx}
    width={100}
    maxRows={14}
    error={errorState.error}
  />,
);

console.log("captured settings overlays");
process.exit(0);
