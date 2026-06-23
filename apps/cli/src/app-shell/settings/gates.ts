import type { SettingGate, SettingsRegistryContext, SettingRowDef } from "./types";

function envEnabled(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function tuningEnabled(ctx: SettingsRegistryContext, tuningKey: string): boolean {
  const key = tuningKey as keyof typeof ctx.container.featureFlags;
  const value = ctx.container.featureFlags[key];
  return value !== false;
}

export function isSettingVisible(row: SettingRowDef, ctx: SettingsRegistryContext): boolean {
  const gate = (row as { readonly gate?: SettingGate }).gate;
  if (!gate) return true;
  if (gate.env && !envEnabled(gate.env)) return false;
  if (gate.tuningKey && !tuningEnabled(ctx, gate.tuningKey)) return false;
  if (gate.predicate && !gate.predicate(ctx.config)) return false;
  return true;
}
