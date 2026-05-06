import type { SessionState } from "@/domain/session/SessionState";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { buildSettingsSummary } from "./overlay-panel";
import type { RootOwnedOverlay } from "./root-shell-state";

export function isRootChoiceOverlay(
  overlay: RootOwnedOverlay,
): overlay is Extract<
  RootOwnedOverlay,
  | { type: "provider_picker" }
  | { type: "history" }
  | { type: "settings" }
  | { type: "season_picker" }
  | { type: "episode_picker" }
  | { type: "subtitle_picker" }
  | { type: "source_picker" }
  | { type: "quality_picker" }
> {
  return (
    overlay.type === "provider_picker" ||
    overlay.type === "history" ||
    overlay.type === "settings" ||
    isRootMediaPickerOverlay(overlay)
  );
}

export function isRootMediaPickerOverlay(
  overlay: RootOwnedOverlay,
): overlay is Extract<
  RootOwnedOverlay,
  | { type: "season_picker" }
  | { type: "episode_picker" }
  | { type: "subtitle_picker" }
  | { type: "source_picker" }
  | { type: "quality_picker" }
> {
  return (
    overlay.type === "season_picker" ||
    overlay.type === "episode_picker" ||
    overlay.type === "subtitle_picker" ||
    overlay.type === "source_picker" ||
    overlay.type === "quality_picker"
  );
}

export function getRootOverlayResetKey(overlay: RootOwnedOverlay): string {
  return overlay.type === "episode_picker"
    ? `${overlay.type}:${overlay.season}:${overlay.options.map((option) => option.value).join(",")}`
    : overlay.type;
}

export function getRootOverlayInitialIndex(overlay: RootOwnedOverlay): number {
  return overlay.type === "episode_picker" ? Math.max(0, overlay.initialIndex ?? 0) : 0;
}

export function getRootOverlayTitle(overlay: RootOwnedOverlay): string {
  if (overlay.type === "help") return "Help";
  if (overlay.type === "about") return "About";
  if (overlay.type === "diagnostics") return "Diagnostics";
  if (overlay.type === "history") return "History";
  if (overlay.type === "settings") return "Settings";
  if (overlay.type === "season_picker") return "Choose season";
  if (overlay.type === "episode_picker") return "Choose episode";
  if (overlay.type === "subtitle_picker") return "Choose subtitles";
  if (overlay.type === "source_picker") return "Choose source";
  if (overlay.type === "quality_picker") return "Choose quality";
  return "Provider";
}

export function getRootOverlaySubtitle({
  overlay,
  state,
  settingsDraft,
  config,
  settingsError,
}: {
  readonly overlay: RootOwnedOverlay;
  readonly state: SessionState;
  readonly settingsDraft: KitsuneConfig | null;
  readonly config: KitsuneConfig;
  readonly settingsError: string | null;
}): string {
  if (overlay.type === "help") return "Global commands, editing, filtering, and shell behavior";
  if (overlay.type === "about") return "Kunai beta";
  if (overlay.type === "diagnostics") return "Current runtime snapshot and recent events";
  if (overlay.type === "history") return "Recent playback positions without leaving the shell";
  if (overlay.type === "settings")
    return settingsError ?? buildSettingsSummary(settingsDraft ?? config);
  if (overlay.type === "season_picker") return `Current season ${overlay.currentSeason}`;
  if (overlay.type === "episode_picker") {
    const watched = overlay.options.filter((option) => option.tone === "success").length;
    return watched > 0
      ? `Season ${overlay.season}  ·  ${watched}/${overlay.options.length} watched`
      : `Season ${overlay.season}  ·  Choose an episode`;
  }
  if (overlay.type === "subtitle_picker") return `${overlay.options.length} tracks available`;
  if (overlay.type === "source_picker") return `${overlay.options.length} sources available`;
  if (overlay.type === "quality_picker")
    return `${overlay.options.length} quality options available`;
  return `Current provider ${state.provider}`;
}
