import { expect, test } from "bun:test";

import { createPaletteWorkflowPort } from "@/app-shell/palette-workflow-port";

test("stats loads only the shell workflow module", async () => {
  const loaded: string[] = [];
  const actions: string[] = [];
  const port = createPaletteWorkflowPort({
    loadShellWorkflows: async () => {
      loaded.push("shell");
      return {
        handleShellAction: async ({ action }) => {
          actions.push(action);
          return "handled" as const;
        },
        resolveQuitWithDownloadQueue: async () => "quit" as const,
      };
    },
    loadSetupWorkflow: async () => {
      loaded.push("setup");
      return { openSetupWizardFromShell: async () => "completed" as const };
    },
  });

  await expect(port.runAction("stats", {} as never)).resolves.toBe("handled");
  expect(loaded).toEqual(["shell"]);
  expect(actions).toEqual(["stats"]);
});

test("setup loads only the focused setup module", async () => {
  const loaded: string[] = [];
  const port = createPaletteWorkflowPort({
    loadShellWorkflows: async () => {
      loaded.push("shell");
      throw new Error("shell workflows should stay unloaded");
    },
    loadSetupWorkflow: async () => {
      loaded.push("setup");
      return { openSetupWizardFromShell: async () => "completed" as const };
    },
  });

  await expect(port.runSetup({} as never)).resolves.toBe("handled");
  expect(loaded).toEqual(["setup"]);
});
