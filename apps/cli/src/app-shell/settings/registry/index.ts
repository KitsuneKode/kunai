import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { generalSettingsRows } from "./general";
import { playbackSettingsRows } from "./playback";
import { presenceSettingsRows } from "./presence";
import { privacySettingsRows } from "./privacy";
import { providerSettingsRows } from "./providers";
import { relaySettingsRows } from "./relay";
import { syncSettingsRows } from "./sync";
import { youtubeSettingsRows } from "./youtube";

export function buildSettingsRegistry(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    ...generalSettingsRows(ctx),
    ...providerSettingsRows(ctx),
    ...relaySettingsRows(ctx),
    ...youtubeSettingsRows(ctx),
    ...playbackSettingsRows(ctx),
    {
      kind: "section",
      id: "section:accounts",
      label: "Accounts & Sync",
      tabLabel: "Accounts",
      detail: "AniList and TMDB tracker sync, plus local Discord Rich Presence",
    },
    ...syncSettingsRows(ctx),
    ...presenceSettingsRows(ctx),
    ...privacySettingsRows(ctx),
  ];
}
