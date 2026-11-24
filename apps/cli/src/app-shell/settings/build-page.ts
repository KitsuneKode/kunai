import { plainModeEnabled, plainModeEnvOverridden } from "@/app-shell/plain-mode";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { isSettingVisible } from "./gates";
import { firstSelectableRowIndex } from "./navigation";
import { describeProviderOrder } from "./provider-order";
import { buildSettingsRegistry } from "./registry";
import type {
  BuiltSettingsPage,
  BuiltSettingsRow,
  SettingRowDef,
  SettingsRegistryContext,
} from "./types";

const TAB_HINT_RESERVE = 20;
const TAB_SEGMENT_GAP = 2;
const TAB_ACTIVE_PADDING = 2;

const LEGACY_SECTION_TARGETS = new Map<string, string>([
  ["section:appearance", "theme"],
  ["section:discover", "subheading:discover"],
  ["section:providers", "subheading:providers"],
  ["section:provider-toggles", "subheading:provider-toggles"],
  ["section:relay", "subheading:relay"],
  ["section:youtube", "subheading:youtube"],
  ["section:language", "subheading:language"],
  ["section:offline-continuation", "subheading:offline-continuation"],
  ["section:presence", "subheading:presence"],
  ["section:sync", "subheading:sync"],
  ["section:updates", "subheading:updates"],
  ["section:storage", "subheading:storage"],
  ["section:danger-zone", "subheading:storage"],
  ["section:advanced", "subheading:advanced"],
  ["section:analytics", "subheading:analytics"],
]);

function envBadgeFor(def: SettingRowDef): string | undefined {
  if (
    (def.kind === "text" || def.kind === "boolean") &&
    def.envOverride &&
    process.env[def.envOverride]?.trim()
  ) {
    return "env";
  }
  return undefined;
}

function disabledReasonFor(def: SettingRowDef): string | undefined {
  if (def.kind === "text" && def.envOverride && process.env[def.envOverride]?.trim()) {
    return `Unset ${def.envOverride} to edit this value in config`;
  }
  if (def.kind === "boolean" && def.envOverride && process.env[def.envOverride]?.trim()) {
    return `Unset ${def.envOverride} to change this.`;
  }
  return undefined;
}

function valueSummaryFor(def: SettingRowDef, config: KitsuneConfig): string {
  switch (def.kind) {
    case "section":
    case "subheading":
      return "";
    case "boolean":
      if (def.id === "plainMode" && plainModeEnvOverridden()) {
        return plainModeEnabled() ? "on" : "off";
      }
      return def.read(config) ? "on" : "off";
    case "enum": {
      const value = def.read(config);
      return def.options.find((option) => option.value === value)?.label ?? value;
    }
    case "text": {
      if (def.summarize) return def.summarize(config);
      const raw = def.read(config);
      if (def.sensitive) return raw ? "configured" : "not set";
      if (!raw.trim()) return "not set";
      if (def.id === "providerRelayBaseUrl") {
        try {
          return new URL(raw).host;
        } catch {
          return "configured";
        }
      }
      return raw.length > 32 ? `${raw.slice(0, 29)}…` : raw;
    }
    case "submenu":
      return def.summarize(config);
    case "reorder":
      return describeProviderOrder(def.resolveOrder(config));
    case "status":
      return "";
    case "action":
      return "";
    default:
      return "";
  }
}

function labelFor(def: SettingRowDef, _config: KitsuneConfig): string {
  if (
    def.kind === "section" ||
    def.kind === "subheading" ||
    def.kind === "status" ||
    def.kind === "action"
  ) {
    return def.label;
  }
  if (
    def.kind === "boolean" ||
    def.kind === "text" ||
    def.kind === "reorder" ||
    (def.kind === "enum" && def.presentation === "segment")
  ) {
    return def.label;
  }
  const summary = valueSummaryFor(def, _config);
  if (!summary) return def.label;
  return `${def.label}  ·  ${summary}`;
}

function buildRow(def: SettingRowDef, config: KitsuneConfig): BuiltSettingsRow {
  return {
    def,
    label: labelFor(def, config),
    detail: def.detail,
    valueSummary: valueSummaryFor(def, config),
    disabledReason: disabledReasonFor(def),
    envBadge: envBadgeFor(def),
  };
}

export function buildSettingsSummary(config: KitsuneConfig): string {
  return `${config.defaultMode} default  ·  discover ${config.discoverMode}  ·  series ${config.provider}  ·  anime ${config.animeProvider}`;
}

export function listSettingsSectionLabels(ctx: SettingsRegistryContext): readonly string[] {
  return buildSettingsRegistry(ctx)
    .filter((row) => isSettingVisible(row, ctx) && row.kind === "section")
    .map((row) => row.label);
}

function tabStripRequiredWidth(labels: readonly string[]): number {
  if (labels.length === 0) return 0;
  return (
    labels.reduce((sum, label) => sum + label.length, 0) +
    (labels.length - 1) * TAB_SEGMENT_GAP +
    TAB_ACTIVE_PADDING
  );
}

export function listSettingsTabLabels(
  ctx: SettingsRegistryContext,
  maxWidth: number,
  hasHint: boolean,
): readonly string[] {
  const sections = buildSettingsRegistry(ctx).filter(
    (row): row is Extract<SettingRowDef, { kind: "section" }> =>
      isSettingVisible(row, ctx) && row.kind === "section",
  );
  const full = sections.map((section) => section.label);
  const tabBudget = maxWidth - (hasHint ? TAB_HINT_RESERVE : 0);
  if (tabBudget >= tabStripRequiredWidth(full)) {
    return full;
  }
  return sections.map((section) => section.tabLabel ?? section.label);
}

function isFocusableSettingRow(row: BuiltSettingsRow): boolean {
  return row.def.kind !== "section" && row.def.kind !== "subheading" && row.def.kind !== "status";
}

export type SettingsInitialLocation = {
  readonly activeSectionIndex: number;
  readonly selectedIndex: number;
};

export function resolveSettingsInitialLocation(
  ctx: SettingsRegistryContext,
  initialSectionId?: string,
): SettingsInitialLocation {
  if (!initialSectionId) {
    const page = buildSettingsPage(ctx, { activeSectionIndex: 0 });
    return { activeSectionIndex: 0, selectedIndex: firstSelectableRowIndex(page) };
  }

  const targetId = LEGACY_SECTION_TARGETS.get(initialSectionId) ?? initialSectionId;
  const visible = buildSettingsRegistry(ctx).filter((row) => isSettingVisible(row, ctx));

  let currentSectionIndex = -1;
  let targetSectionIndex = 0;
  let foundTarget = false;

  for (const row of visible) {
    if (row.kind === "section") {
      currentSectionIndex += 1;
    }
    if (row.id === targetId) {
      targetSectionIndex = Math.max(0, currentSectionIndex);
      foundTarget = true;
      break;
    }
  }

  if (!foundTarget) {
    const page = buildSettingsPage(ctx, { activeSectionIndex: 0 });
    return { activeSectionIndex: 0, selectedIndex: firstSelectableRowIndex(page) };
  }

  const page = buildSettingsPage(ctx, { activeSectionIndex: targetSectionIndex });
  const targetIndex = page.rows.findIndex((row) => row.def.id === targetId);
  if (targetIndex < 0 || page.rows[targetIndex]?.def.kind === "section") {
    return { activeSectionIndex: targetSectionIndex, selectedIndex: firstSelectableRowIndex(page) };
  }

  if (page.rows[targetIndex]?.def.kind === "subheading") {
    for (let i = targetIndex + 1; i < page.rows.length; i += 1) {
      const candidate = page.rows[i];
      if (!candidate) break;
      if (candidate.def.kind === "section" || candidate.def.kind === "subheading") break;
      if (isFocusableSettingRow(candidate)) {
        return { activeSectionIndex: targetSectionIndex, selectedIndex: i };
      }
    }
    return { activeSectionIndex: targetSectionIndex, selectedIndex: firstSelectableRowIndex(page) };
  }

  const targetRow = page.rows[targetIndex];
  const selectedIndex =
    targetRow && isFocusableSettingRow(targetRow) ? targetIndex : firstSelectableRowIndex(page);
  return { activeSectionIndex: targetSectionIndex, selectedIndex };
}

function sliceRowsForSection(
  rows: readonly BuiltSettingsRow[],
  sectionIndex: number,
): readonly BuiltSettingsRow[] {
  const sectionStarts = rows
    .map((row, index) => (row.def.kind === "section" ? index : -1))
    .filter((index) => index >= 0);
  const start = sectionStarts[sectionIndex];
  if (start === undefined) return rows;
  const end = sectionStarts[sectionIndex + 1] ?? rows.length;
  return rows.slice(start, end);
}

export function buildSettingsPage(
  ctx: SettingsRegistryContext,
  options?: { readonly searchQuery?: string; readonly activeSectionIndex?: number },
): BuiltSettingsPage {
  const search = options?.searchQuery?.trim().toLowerCase() ?? "";
  const defs = buildSettingsRegistry(ctx).filter((row) => isSettingVisible(row, ctx));
  const rows: BuiltSettingsRow[] = [];
  const rowById = new Map<string, BuiltSettingsRow>();
  const defById = new Map<string, SettingRowDef>();

  for (const def of defs) {
    if (search && def.kind !== "section" && def.kind !== "subheading") {
      const haystack = `${def.id} ${def.label} ${def.detail ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }
    const built = buildRow(def, ctx.config);
    rows.push(built);
    if (def.kind !== "section" && def.kind !== "subheading") {
      rowById.set(def.id, built);
      defById.set(def.id, def);
    }
  }

  if (search) {
    const withSections: BuiltSettingsRow[] = [];
    let lastSection: BuiltSettingsRow | null = null;
    let lastSubheading: BuiltSettingsRow | null = null;
    for (const row of rows) {
      if (row.def.kind === "section") {
        lastSection = row;
        lastSubheading = null;
        continue;
      }
      if (row.def.kind === "subheading") {
        lastSubheading = row;
        continue;
      }
      if (lastSection && !withSections.some((r) => r.def.id === lastSection?.def.id)) {
        withSections.push(lastSection);
      }
      if (lastSubheading && !withSections.some((r) => r.def.id === lastSubheading?.def.id)) {
        withSections.push(lastSubheading);
      }
      withSections.push(row);
    }
    return {
      title: "Settings",
      subtitle: buildSettingsSummary(ctx.config),
      rows: withSections,
      rowById,
      defById,
    };
  }

  const sectionIndex = options?.activeSectionIndex ?? 0;
  const sectionRows = sliceRowsForSection(rows, sectionIndex);

  return {
    title: "Settings",
    subtitle: buildSettingsSummary(ctx.config),
    rows: sectionRows,
    rowById,
    defById,
  };
}
