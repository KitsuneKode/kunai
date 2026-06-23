import { useLineEditor } from "@/app-shell/line-editor";
import { movePickerModelSelection } from "@/domain/session/picker-model";
import { useInput } from "ink";
import { useEffect, useState } from "react";

import type { ResolvedAppCommand } from "./commands";
import { recordInputDrop } from "./diagnostics/render-trace";
import { routeShellInput } from "./input-router";
import {
  buildCommandPickerModel,
  getCommandAutocompleteTarget,
  getHighlightedCommand,
} from "./shell-command-model";
import { toShellAction, type FooterAction, type ShellAction } from "./types";

export function useShellInput({
  footerActions,
  commands,
  disabled = false,
  letterKeysHandledExternally = false,
  escapeAction = "quit",
  onResolve,
}: {
  footerActions: readonly FooterAction[];
  commands: readonly ResolvedAppCommand[];
  disabled?: boolean;
  /** When true, letter footer shortcuts are owned by the playback surface; `/` still opens commands. */
  letterKeysHandledExternally?: boolean;
  escapeAction?: ShellAction | null;
  onResolve: (action: ShellAction) => void;
}) {
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedIndex(0);
    },
  });

  useEffect(() => {
    if (!disabled) return;
    setCommandMode(false);
    setCommandInput("");
    setHighlightedIndex(0);
  }, [disabled]);

  useInput((input, key) => {
    if (disabled) {
      recordInputDrop("shell-input", "input-locked", input);
      return;
    }

    const route = routeShellInput(input, key, { commandPaletteOpen: commandMode });
    if (route.owner === "hard-global") return;

    if (key.escape) {
      if (commandMode) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      if (escapeAction) onResolve(escapeAction);
      return;
    }

    if (commandMode) {
      const model = buildCommandPickerModel(commandInput, commands, highlightedIndex);

      if (key.return) {
        const resolved = getHighlightedCommand(commandInput, commands, highlightedIndex);
        if (resolved?.enabled) {
          onResolve(toShellAction(resolved.id));
          return;
        }
        return;
      }
      if (key.tab) {
        const target = getCommandAutocompleteTarget(commandInput, commands, highlightedIndex);
        if (target) {
          commandEditor.setValue(target.aliases[0] ?? target.id);
          const targetIndex = model.options.findIndex((option) => option.value === target.id);
          setHighlightedIndex(Math.max(0, targetIndex));
        }
        return;
      }
      if (key.upArrow) {
        if (model.options.length > 0) {
          setHighlightedIndex(movePickerModelSelection(model, -1));
        }
        return;
      }
      if (key.downArrow) {
        if (model.options.length > 0) {
          setHighlightedIndex(movePickerModelSelection(model, 1));
        }
        return;
      }
      if (commandEditor.handleInput(input, key)) {
        return;
      }
      return;
    }

    if (route.command === "open-command-palette" && commands.length > 0) {
      setCommandMode(true);
      setCommandInput("");
      return;
    }

    const matchKey = input.toLowerCase();
    const footerAction = footerActions.find(
      (action) => action.key === matchKey && !action.disabled,
    );
    if (footerAction) {
      if (footerAction.action === "command-mode") {
        setCommandMode(true);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      if (letterKeysHandledExternally) {
        // The letter binding exists but the playback/loading surface owns letters;
        // `/` still opened the palette above. Surface this so a "first press did
        // nothing" report can be traced to external ownership rather than a bug.
        recordInputDrop("shell-input", "handled-externally", input);
        return;
      }
      if (footerAction.action) {
        onResolve(footerAction.action);
        return;
      }
    }
    // A binding exists for this key but is currently disabled — a common cause of a
    // press that "does nothing". (Unbound keys are intentionally NOT logged here:
    // sibling surface `useInput` handlers commonly own them, so a frame-level
    // "no-binding" would be misleading.)
    if (footerActions.some((action) => action.key === matchKey && action.disabled)) {
      recordInputDrop("shell-input", "binding-disabled", input);
    }
  });

  return { commandMode, commandInput, commandCursor: commandEditor.cursor, highlightedIndex };
}
