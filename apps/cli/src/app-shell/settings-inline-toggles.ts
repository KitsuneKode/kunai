import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import {
  setProviderRelayEnabled,
  setProviderRelayFallbackToDirect,
} from "@/services/providers/provider-relay-settings";

import type { SettingsChoiceValue } from "./overlay-panel";

export const SETTINGS_INLINE_TOGGLE_ACTIONS = new Set<SettingsChoiceValue>([
  "showMemory",
  "autoNext",
  "providerRelayEnabled",
  "providerRelayFallbackToDirect",
  "discoverShowOnStartup",
  "recommendationRailEnabled",
  "downloadsEnabled",
  "powerSaverMode",
  "autoCleanupWatched",
  "resumeStartChoicePrompt",
  "skipRecap",
  "skipIntro",
  "skipCredits",
  "skipPreview",
]);

export function isSettingsInlineToggle(value: string | undefined): value is SettingsChoiceValue {
  return value !== undefined && SETTINGS_INLINE_TOGGLE_ACTIONS.has(value as SettingsChoiceValue);
}

export function applySettingsInlineToggle(
  draft: KitsuneConfig,
  action: SettingsChoiceValue,
): KitsuneConfig | null {
  switch (action) {
    case "showMemory":
      return { ...draft, showMemory: !draft.showMemory };
    case "autoNext":
      return { ...draft, autoNext: !draft.autoNext };
    case "providerRelayEnabled":
      return {
        ...draft,
        providerRelay: setProviderRelayEnabled(
          draft.providerRelay,
          draft.providerRelay.enabled === false,
        ),
      };
    case "providerRelayFallbackToDirect": {
      const current = draft.providerRelay.fallbackToDirect !== false;
      return {
        ...draft,
        providerRelay: setProviderRelayFallbackToDirect(draft.providerRelay, !current),
      };
    }
    case "discoverShowOnStartup":
      return { ...draft, discoverShowOnStartup: !draft.discoverShowOnStartup };
    case "recommendationRailEnabled":
      return { ...draft, recommendationRailEnabled: !draft.recommendationRailEnabled };
    case "downloadsEnabled":
      return { ...draft, downloadsEnabled: !draft.downloadsEnabled };
    case "powerSaverMode":
      return { ...draft, powerSaverMode: !draft.powerSaverMode };
    case "autoCleanupWatched":
      return { ...draft, autoCleanupWatched: !draft.autoCleanupWatched };
    case "resumeStartChoicePrompt":
      return { ...draft, resumeStartChoicePrompt: !draft.resumeStartChoicePrompt };
    case "skipRecap":
      return { ...draft, skipRecap: !draft.skipRecap };
    case "skipIntro":
      return { ...draft, skipIntro: !draft.skipIntro };
    case "skipCredits":
      return { ...draft, skipCredits: !draft.skipCredits };
    case "skipPreview":
      return { ...draft, skipPreview: !draft.skipPreview };
    default:
      return null;
  }
}
