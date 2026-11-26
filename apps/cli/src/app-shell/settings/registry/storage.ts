import {
  preSetupSnapshotExists,
  readPreSetupSnapshot,
} from "@/services/persistence/pre-setup-snapshot";

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
  // Read once per page build, not per row render — the gate below closes over
  // the answer so opening Settings costs a single `existsSync`.
  const snapshotExists = preSetupSnapshotExists();
  return [
    {
      kind: "subheading",
      id: "subheading:storage",
      label: "Reset & Danger Zone",
      detail: "Destructive — irreversible actions",
      tone: "danger",
    },
    {
      kind: "action",
      id: "restorePreSetupConfig",
      label: "Undo the last setup run",
      detail: "Restore every setting exactly as it was before setup last wrote to it",
      // Existence is read once, while the page is built, rather than on every
      // row render. A row offering to restore a file that is not there is worse
      // than no row, so it simply is not offered.
      gate: { predicate: () => snapshotExists },
      run: async (actionCtx) => {
        const snapshot = await readPreSetupSnapshot();
        if (!snapshot) return "No saved configuration to restore.";
        // Restored whole and exactly — onboarding gate included — except the
        // consent-owned keys readPreSetupSnapshot strips: "undo the setup run"
        // means the run, not a way to resurrect a revoked analytics opt-in.
        // Through the runtime path, so the restored mode, providers, theme and
        // languages apply now instead of after a restart.
        const { applySettingsToRuntime } =
          await import("@/app/bootstrap/apply-settings-to-runtime");
        await applySettingsToRuntime({ container: actionCtx.container, next: snapshot });
        return "Restored the settings saved before your last setup run.";
      },
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
      id: "resetProviderHealth",
      label: "Reset provider health",
      detail: "Forget local provider failure memory so auto-fallback can retry",
      tone: "danger",
      run: async (ctx) => {
        const { handleShellAction } = await import("../../workflows");
        await handleShellAction({ action: "reset-provider-health", container: ctx.container });
        return "Provider health reset.";
      },
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
