import type { LineEditorKey } from "@/app-shell/line-editor";

import { resolveShellInputCommand } from "./keybinding-runtime";

export type ShellInputOwner =
  | "hard-global"
  | "command-palette"
  | "modal"
  | "text-input"
  | "surface";

export type ShellInputRouteContext = {
  readonly commandPaletteOpen?: boolean;
  readonly modalOpen?: boolean;
  readonly textInputFocused?: boolean;
};

export type ShellInputRoute = {
  readonly owner: ShellInputOwner;
  readonly command: ShellInputCommand | null;
};

export type ShellInputCommand = "quit" | "open-command-palette";

export function routeShellInput(
  input: string,
  key: LineEditorKey,
  context: ShellInputRouteContext,
): ShellInputRoute {
  const keybindingCommand = resolveShellInputCommand(["global"], input, key);

  if (keybindingCommand === "quit" || input === "\x03") {
    return { owner: "hard-global", command: "quit" };
  }

  if (context.commandPaletteOpen) {
    return { owner: "command-palette", command: null };
  }

  if (context.modalOpen) {
    return { owner: "modal", command: null };
  }

  if (context.textInputFocused) {
    return {
      owner: "text-input",
      command: keybindingCommand === "open-command-palette" ? keybindingCommand : null,
    };
  }

  return {
    owner: "surface",
    command: keybindingCommand === "open-command-palette" ? keybindingCommand : null,
  };
}

export function isHardGlobalQuit(input: string, key: LineEditorKey): boolean {
  return resolveShellInputCommand(["global"], input, key) === "quit" || input === "\x03";
}
