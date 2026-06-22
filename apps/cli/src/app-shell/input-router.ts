import type { LineEditorKey } from "@/app-shell/line-editor";

import { resolveShellInputCommand } from "./keybinding-runtime";

export type ShellInputOwner =
  | "hard-global"
  | "command-palette"
  | "modal"
  | "overlay"
  | "text-input"
  | "surface";

export type ShellInputRouteContext = {
  readonly commandPaletteOpen?: boolean;
  readonly modalOpen?: boolean;
  readonly overlayOpen?: boolean;
  readonly textInputFocused?: boolean;
};

export type ShellInputRoute = {
  readonly owner: ShellInputOwner;
  readonly command: ShellInputCommand | null;
};

export type OverlayInputCommand = "close" | "help" | "page-up" | "page-down";

export type ShellInputCommand = "quit" | "open-command-palette" | OverlayInputCommand;

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

function resolveOverlayInputCommand(input: string, key: LineEditorKey): OverlayInputCommand | null {
  if (key.escape) return "close";
  if (input === "?" && !key.ctrl && !key.meta) return "help";
  if (input === "[" || (key.shift && key.upArrow)) return "page-up";
  if (input === "]" || (key.shift && key.downArrow)) return "page-down";
  return null;
}

/** Overlay host routing for shared close/help/pagination chords. */
export function routeOverlayInput(
  input: string,
  key: LineEditorKey,
  context: ShellInputRouteContext,
): ShellInputRoute {
  const quit = isHardGlobalQuit(input, key);
  if (quit) {
    return { owner: "hard-global", command: "quit" };
  }

  if (context.commandPaletteOpen) {
    return { owner: "command-palette", command: null };
  }

  if (context.textInputFocused) {
    const palette = resolveShellInputCommand(["global"], input, key);
    return {
      owner: "text-input",
      command: palette === "open-command-palette" ? palette : null,
    };
  }

  const overlayCommand = resolveOverlayInputCommand(input, key);
  if (context.overlayOpen) {
    return {
      owner: "overlay",
      command: overlayCommand,
    };
  }

  if (context.modalOpen) {
    return { owner: "modal", command: null };
  }

  return routeShellInput(input, key, context);
}
