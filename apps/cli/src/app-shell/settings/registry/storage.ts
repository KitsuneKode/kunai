import type { SettingRowDef, SettingsRegistryContext } from "../types";

async function runShellAction(
  ctx: SettingsRegistryContext,
  action: "clear-cache" | "clear-history",
): Promise<string> {
  const { handleShellAction } = await import("../../workflows");
  await handleShellAction({ action, container: ctx.container });
  return action === "clear-cache" ? "Stream cache cleared." : "Watch history cleared.";
}

export function storageSettingsRows(_ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:storage",
      label: "Danger Zone",
      detail: "Destructive — irreversible actions",
      layout: "danger-zone",
    },
    {
      kind: "action",
      id: "clearCache",
      label: "Clear stream cache",
      detail: "Wipe the local SQLite stream cache",
      tone: "danger",
      run: async (ctx) => runShellAction(ctx, "clear-cache"),
    },
    {
      kind: "action",
      id: "clearHistory",
      label: "Clear watch history",
      detail: "Reset all watch progress and history",
      tone: "danger",
      run: async (ctx) => runShellAction(ctx, "clear-history"),
    },
  ];
}
