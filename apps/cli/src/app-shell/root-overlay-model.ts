import type { SessionState } from "@/domain/session/SessionState";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import type { RootOwnedOverlay } from "./root-shell-state";
import { buildSettingsSummary } from "./settings/build-page";
import type { ShellPickerOption } from "./types";

export function isRootChoiceOverlay(
  overlay: RootOwnedOverlay,
): overlay is Extract<
  RootOwnedOverlay,
  | { type: "provider_picker" }
  | { type: "history" }
  | { type: "queue" }
  | { type: "notifications" }
  | { type: "settings" }
  | { type: "season_picker" }
  | { type: "episode_picker" }
  | { type: "subtitle_picker" }
  | { type: "recommendation_picker" }
> {
  return (
    overlay.type === "provider_picker" ||
    overlay.type === "history" ||
    overlay.type === "queue" ||
    overlay.type === "notifications" ||
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
  | { type: "recommendation_picker" }
> {
  return (
    overlay.type === "season_picker" ||
    overlay.type === "episode_picker" ||
    overlay.type === "subtitle_picker" ||
    overlay.type === "recommendation_picker"
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

export function buildRootGenericPickerOptions(
  overlay: Extract<
    RootOwnedOverlay,
    | { type: "season_picker" }
    | { type: "episode_picker" }
    | { type: "subtitle_picker" }
    | { type: "recommendation_picker" }
  >,
): readonly ShellPickerOption<string>[] {
  return overlay.options.map((option) => ({
    value: option.value,
    label: option.label,
    detail: option.detail,
    previewBody: option.previewBody,
    previewImageUrl: option.previewImageUrl,
    tone: option.tone,
    badge: option.badge,
  }));
}

export function getRootOverlayTitle(overlay: RootOwnedOverlay, _state: SessionState): string {
  if (overlay.type === "help") return "Help";
  if (overlay.type === "about") return "About";
  if (overlay.type === "diagnostics") return "Diagnostics";
  if (overlay.type === "downloads") return "Downloads";
  if (overlay.type === "library") {
    return overlay.view === "queue" ? "Downloads" : "Library";
  }
  if (overlay.type === "history") return "History";
  if (overlay.type === "queue") return "Up Next";
  if (overlay.type === "notifications") return "Notifications";
  if (overlay.type === "settings") return "Settings";
  if (overlay.type === "season_picker") return "Choose season";
  if (overlay.type === "episode_picker") return "Choose episode";
  if (overlay.type === "subtitle_picker") return "Choose subtitles";
  if (overlay.type === "recommendation_picker") return "Recommendations";
  if (overlay.type === "tracks_panel") return "Tracks";
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
  if (overlay.type === "about") return "Kunai";
  if (overlay.type === "diagnostics") return "Current runtime snapshot and recent spans";
  if (overlay.type === "downloads")
    return "Live download queue, failed retries, and completed jobs";
  if (overlay.type === "library")
    return "Offline library · resume-ready downloads · queue and cleanup controls";
  if (overlay.type === "history")
    return "Resume-first · new since last watched · continue without leaving the shell";
  if (overlay.type === "queue")
    return "Reorder, remove, and play what's next · g play-next · x remove · c clear";
  if (overlay.type === "notifications")
    return "New episodes, queue recovery, downloads, and app notices";
  if (overlay.type === "settings")
    return settingsError ?? buildSettingsSummary(settingsDraft ?? config);
  if (overlay.type === "season_picker") return `Current season ${overlay.currentSeason}`;
  if (overlay.type === "episode_picker") {
    const seriesName = state.currentTitle?.name ?? "Series";
    const watched = overlay.options.filter((option) => option.tone === "success").length;
    const total = overlay.options.length;
    const progress = total > 0 ? Math.round((watched / total) * 100) : 0;
    const parts = [seriesName, `S${String(overlay.season).padStart(2, "0")}`, `${total} eps`];
    if (progress > 0) parts.push(`${progress}% complete`);
    parts.push("s season", "m watched");
    return parts.join("  ·  ");
  }
  if (overlay.type === "subtitle_picker") return `${overlay.options.length} tracks available`;
  if (overlay.type === "recommendation_picker")
    return `${overlay.options.length} picks based on your watch history`;
  if (overlay.type === "tracks_panel") {
    const provider = state.provider;
    return provider ? `Provider ${provider}` : "Choose source, quality, or audio";
  }
  return `Current provider ${state.provider}`;
}
