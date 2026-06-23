import type { KitsuneConfig } from "@/services/persistence/ConfigService";

import { isSettingVisible } from "./gates";
import { describeProviderOrder } from "./provider-order";
import { buildSettingsRegistry } from "./registry";
import type {
  BuiltSettingsPage,
  BuiltSettingsRow,
  SettingRowDef,
  SettingsRegistryContext,
} from "./types";

function envBadgeFor(def: SettingRowDef): string | undefined {
  if (def.kind === "text" && def.envOverride && process.env[def.envOverride]?.trim()) {
    return "env";
  }
  return undefined;
}

function disabledReasonFor(def: SettingRowDef): string | undefined {
  if (def.kind === "text" && def.envOverride && process.env[def.envOverride]?.trim()) {
    return `Unset ${def.envOverride} to edit this value in config`;
  }
  return undefined;
}

function valueSummaryFor(def: SettingRowDef, config: KitsuneConfig): string {
  switch (def.kind) {
    case "section":
      return "";
    case "boolean":
      return def.read(config) ? "on" : "off";
    case "enum":
      return def.read(config);
    case "text": {
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
  if (def.kind === "section" || def.kind === "status" || def.kind === "action") {
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

export function buildSettingsPage(
  ctx: SettingsRegistryContext,
  options?: { readonly searchQuery?: string },
): BuiltSettingsPage {
  const search = options?.searchQuery?.trim().toLowerCase() ?? "";
  const defs = buildSettingsRegistry(ctx).filter((row) => isSettingVisible(row, ctx));
  const rows: BuiltSettingsRow[] = [];
  const rowById = new Map<string, BuiltSettingsRow>();
  const defById = new Map<string, SettingRowDef>();

  for (const def of defs) {
    if (search && def.kind !== "section") {
      const haystack = `${def.id} ${def.label} ${def.detail ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) continue;
    }
    const built = buildRow(def, ctx.config);
    rows.push(built);
    if (def.kind !== "section") {
      rowById.set(def.id, built);
      defById.set(def.id, def);
    }
  }

  if (search) {
    const withSections: BuiltSettingsRow[] = [];
    let lastSection: BuiltSettingsRow | null = null;
    for (const row of rows) {
      if (row.def.kind === "section") {
        lastSection = row;
        continue;
      }
      if (lastSection && !withSections.some((r) => r.def.id === lastSection?.def.id)) {
        withSections.push(lastSection);
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

  return {
    title: "Settings",
    subtitle: buildSettingsSummary(ctx.config),
    rows,
    rowById,
    defById,
  };
}
