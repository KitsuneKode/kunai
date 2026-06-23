import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { discoverSettingsRows } from "./discover";
import { generalSettingsRows } from "./general";
import { languageSettingsRows } from "./language";
import { playbackSettingsRows } from "./playback";
import { presenceSettingsRows } from "./presence";
import { providerSettingsRows } from "./providers";
import { relaySettingsRows } from "./relay";
import { storageSettingsRows } from "./storage";
import { updateSettingsRows } from "./updates";

export function buildSettingsRegistry(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    ...generalSettingsRows(ctx),
    ...discoverSettingsRows(ctx),
    ...providerSettingsRows(ctx),
    ...relaySettingsRows(ctx),
    ...languageSettingsRows(ctx),
    ...playbackSettingsRows(ctx),
    ...presenceSettingsRows(ctx),
    ...updateSettingsRows(ctx),
    ...storageSettingsRows(ctx),
  ];
}
