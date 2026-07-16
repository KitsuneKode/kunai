import type { Container } from "@/container";

import type { ShellAction } from "./types";
import type { ShellWorkflowResult } from "./workflows/shell-workflows";

export type PaletteWorkflowLoaders = {
  readonly loadShellWorkflows: () => Promise<
    Pick<
      typeof import("./workflows/shell-workflows"),
      "handleShellAction" | "resolveQuitWithDownloadQueue"
    >
  >;
  readonly loadSetupWorkflow: () => Promise<
    Pick<typeof import("./workflows/setup-workflows"), "openSetupWizardFromShell">
  >;
};

const defaultLoaders: PaletteWorkflowLoaders = {
  loadShellWorkflows: () => import("./workflows/shell-workflows"),
  loadSetupWorkflow: () => import("./workflows/setup-workflows"),
};

export interface PaletteWorkflowPort {
  resolveQuit(container: Container): Promise<"handled" | "quit">;
  runSetup(container: Container): Promise<"handled">;
  runAction(action: ShellAction, container: Container): Promise<ShellWorkflowResult>;
}

export function createPaletteWorkflowPort(
  loaders: Partial<PaletteWorkflowLoaders> = {},
): PaletteWorkflowPort {
  const resolved = { ...defaultLoaders, ...loaders };
  return {
    async resolveQuit(container) {
      const result = await (
        await resolved.loadShellWorkflows()
      ).resolveQuitWithDownloadQueue(container);
      return result === "quit" ? "quit" : "handled";
    },
    async runSetup(container) {
      const { openSetupWizardFromShell } = await resolved.loadSetupWorkflow();
      await openSetupWizardFromShell(container, { force: true, closeOverlays: true });
      return "handled";
    },
    async runAction(action, container) {
      const { handleShellAction } = await resolved.loadShellWorkflows();
      return handleShellAction({ action, container });
    },
  };
}

export const defaultPaletteWorkflowPort = createPaletteWorkflowPort();
