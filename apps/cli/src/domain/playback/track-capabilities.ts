import type {
  PlaybackInventoryOptionState,
  PlaybackSourceInventoryView,
} from "@/services/playback/PlaybackSourceInventoryView";

/**
 * Normalized, render-ready track capability model for the unified Tracks panel
 * (`/tracks`, `/source`, `/quality`). This is the backend contract the panel
 * renders from — the UI must never reach into raw provider fragments, only this
 * normalized shape. See `.design/cli/surfaces/tracks-panel.md`.
 */
export type TrackCapabilitySection = "source" | "quality" | "audio" | "subtitle" | "hardsub";

export type TrackCapabilityRisk = "normal" | "fallback" | "failed" | "unavailable";

export type TrackCapability = {
  readonly section: TrackCapabilitySection;
  readonly label: string;
  /** Stable id used to apply a selection (stream id, subtitle url, etc.). */
  readonly value: string;
  readonly selected: boolean;
  /** True when choosing this row actually changes playback (a real alternative). */
  readonly enabled: boolean;
  readonly reason?: string;
  readonly detail?: string;
  readonly risk: TrackCapabilityRisk;
};

export type TrackCapabilityGroup = {
  readonly section: TrackCapabilitySection;
  readonly title: string;
  readonly rows: readonly TrackCapability[];
  /** False when the section has no switchable alternative — render as facts. */
  readonly selectable: boolean;
  /** Present when a section cannot offer choices, explaining why. */
  readonly emptyReason?: string;
};

const SECTION_TITLES: Record<TrackCapabilitySection, string> = {
  source: "Source",
  quality: "Quality",
  audio: "Audio",
  subtitle: "Subtitles",
  hardsub: "Hardsub",
};

const SECTION_ORDER: readonly TrackCapabilitySection[] = [
  "source",
  "quality",
  "audio",
  "subtitle",
  "hardsub",
];

function riskFromState(state: PlaybackInventoryOptionState): TrackCapabilityRisk {
  switch (state) {
    case "failed":
      return "failed";
    case "skipped":
      return "fallback";
    case "disabled":
      return "unavailable";
    default:
      return "normal";
  }
}

function detailFromNativeLabels(
  nativeLabels: readonly string[],
  label: string,
): string | undefined {
  const extras = nativeLabels.filter((native) => native && native !== label);
  return extras.length > 0 ? extras.join(" · ") : undefined;
}

/**
 * Build the normalized, sectioned track capability model from the inventory view.
 *
 * Row rules (from the spec):
 * - A row is selectable only when it is a real, switchable alternative (`available`).
 * - The current row and informational rows render as facts (`enabled: false`).
 * - Subtitles are informational by default — Kunai attaches tracks to mpv — and
 *   are only selectable when the backend exposes a pre-play choice that changes
 *   stream resolution (`restartRequired`).
 */
export function buildTrackCapabilities(
  view: PlaybackSourceInventoryView | null | undefined,
): readonly TrackCapabilityGroup[] {
  if (!view) return [];

  const bySection = new Map<TrackCapabilitySection, TrackCapability[]>();
  const push = (capability: TrackCapability): void => {
    const rows = bySection.get(capability.section) ?? [];
    rows.push(capability);
    bySection.set(capability.section, rows);
  };

  for (const group of view.sourceGroups) {
    push({
      section: "source",
      label: group.label,
      value: group.id,
      selected: group.state === "selected",
      enabled: group.state === "available",
      reason: group.disabledReason,
      detail: detailFromNativeLabels(group.nativeLabels, group.label),
      risk: riskFromState(group.state),
    });
  }

  for (const option of view.qualityOptions) {
    push({
      section: "quality",
      label: option.label,
      value: option.id,
      selected: option.state === "selected",
      enabled: option.state === "available",
      reason: option.disabledReason,
      risk: riskFromState(option.state),
    });
  }

  for (const option of view.languageOptions) {
    if (option.role !== "audio" && option.role !== "hardsub") continue;
    push({
      section: option.role,
      label: option.label,
      value: option.id,
      selected: option.state === "selected",
      enabled: option.state === "available",
      reason: option.disabledReason,
      detail: detailFromNativeLabels(option.nativeLabels, option.label),
      risk: riskFromState(option.state),
    });
  }

  for (const option of view.subtitleOptions) {
    // Informational unless the backend exposes a true pre-play choice that
    // changes resolution; otherwise switching belongs to mpv.
    const preplayChoice = option.restartRequired && option.state === "available";
    push({
      section: "subtitle",
      label: option.label,
      value: option.subtitleUrl ?? option.id,
      selected: option.state === "selected",
      enabled: preplayChoice,
      reason: preplayChoice
        ? option.disabledReason
        : (option.disabledReason ?? "attached in mpv · switch in the player"),
      detail: detailFromNativeLabels(option.nativeLabels, option.label),
      risk: riskFromState(option.state),
    });
  }

  const groups: TrackCapabilityGroup[] = [];
  for (const section of SECTION_ORDER) {
    const rows = bySection.get(section);
    if (!rows || rows.length === 0) continue;
    groups.push({
      section,
      title: SECTION_TITLES[section],
      rows,
      selectable: rows.some((row) => row.enabled),
    });
  }
  return groups;
}
