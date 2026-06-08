import { useLineEditor } from "@/app-shell/line-editor";
import { movePickerModelSelection } from "@/domain/session/picker-model";
import { useInput } from "ink";
import { useState } from "react";

import type { ResolvedAppCommand } from "./commands";
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

  useInput((input, key) => {
    if (disabled) {
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

    const footerAction = footerActions.find(
      (action) => action.key === input.toLowerCase() && !action.disabled,
    );
    if (footerAction) {
      if (footerAction.action === "command-mode") {
        setCommandMode(true);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      if (letterKeysHandledExternally) {
        return;
      }
      onResolve(footerAction.action);
    }
  });

  return { commandMode, commandInput, commandCursor: commandEditor.cursor, highlightedIndex };
}
