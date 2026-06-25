import { resolveCommands, type AppCommandId } from "@/app-shell/commands";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";

import type { ListShellActionContext } from "./list-shell-types";

export function buildPickerActionContext({
  container,
  taskLabel,
  footerMode = effectiveFooterHints(container),
  allowed = ["settings", "history", "diagnostics", "help", "about", "quit", "downloads", "library"],
}: {
  container: Container;
  taskLabel: string;
  footerMode?: "detailed" | "minimal";
  allowed?: readonly AppCommandId[];
}): ListShellActionContext {
  return {
    taskLabel,
    footerMode,
    commands: resolveCommands(container.stateManager.getState(), allowed),
    onAction: async (action) => {
      const { handleShellAction } = await import("@/app-shell/workflows/shell-workflows");
      const result = await handleShellAction({ action, container });
      return typeof result === "string" ? result : "handled";
    },
  };
}
