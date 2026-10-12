import { COMMAND_CONTEXTS, resolveCommands, type AppCommandId } from "@/app-shell/commands";
import { pickPaletteTitle } from "@/app-shell/palette-title-launch";
import type { Container } from "@/container";
import { effectiveFooterHints } from "@/container";
import { collectLocalTitleEntries } from "@/services/palette/collect-local-titles";

import type { ListShellActionContext } from "./list-shell-types";

export function buildPickerActionContext({
  container,
  taskLabel,
  footerMode = effectiveFooterHints(container),
  allowed = COMMAND_CONTEXTS.modalPicker,
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
    localTitles: () => collectLocalTitleEntries(container),
    onTitlePick: (entry) => pickPaletteTitle(container, entry),
    onAction: async (action) => {
      const { handleShellAction } = await import("@/app-shell/workflows/shell-workflows");
      const result = await handleShellAction({ action, container });
      return typeof result === "string" ? result : "handled";
    },
  };
}
