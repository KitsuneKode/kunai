import { useLineEditor } from "@/app-shell/line-editor";
import { matchLocalTitles, type LocalTitleEntry } from "@/domain/palette/local-title-index";
import { useInput } from "ink";
import { useEffect, useMemo, useState } from "react";

import type { AppCommandId, ResolvedAppCommand } from "./commands";
import { recordInputDrop } from "./diagnostics/render-trace";
import { routeShellInput } from "./input-router";
import {
  buildCommandPickerModel,
  getCommandAutocompleteTarget,
  movePaletteSelection,
  paletteSelectableCount,
  resolveHighlightedPaletteRow,
} from "./shell-command-model";
import { toShellAction, type FooterAction, type ShellAction } from "./types";

const EMPTY_TITLE_ENTRIES: readonly LocalTitleEntry[] = [];

export function useShellInput({
  footerActions,
  commands,
  disabled = false,
  letterKeysHandledExternally = false,
  escapeAction = "quit",
  onResolve,
  localTitles,
  onTitlePick,
  onPaletteCommand,
}: {
  footerActions: readonly FooterAction[];
  commands: readonly ResolvedAppCommand[];
  disabled?: boolean;
  /** When true, letter footer shortcuts are owned by the playback surface; `/` still opens commands. */
  letterKeysHandledExternally?: boolean;
  escapeAction?: ShellAction | null;
  onResolve: (action: ShellAction) => void;
  /**
   * Local title source consulted ONCE when the palette opens. Must be a cheap
   * synchronous read over an already-built in-memory index — never a query per
   * keystroke. Omit to keep the palette command-only on this surface.
   */
  localTitles?: () => readonly LocalTitleEntry[];
  /** Enter landed on a JUMP TO title row. */
  onTitlePick?: (entry: LocalTitleEntry) => void;
  /** Fires only when a command is picked from the palette — the "long way" signal tips key off. */
  onPaletteCommand?: (commandId: AppCommandId) => void;
}) {
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [titleEntries, setTitleEntries] = useState<readonly LocalTitleEntry[]>(EMPTY_TITLE_ENTRIES);
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedIndex(0);
    },
  });

  const titleMatches = useMemo(
    () => matchLocalTitles(titleEntries, commandInput),
    [titleEntries, commandInput],
  );

  useEffect(() => {
    if (!disabled) return;
    setCommandMode(false);
    setCommandInput("");
    setHighlightedIndex(0);
  }, [disabled]);

  const openCommandPalette = () => {
    setTitleEntries(localTitles?.() ?? EMPTY_TITLE_ENTRIES);
    setCommandMode(true);
    setHighlightedIndex(0);
    // commandInput deliberately survives close/reopen — `/` keeps the draft
    // (Raycast-style); only a completed Enter clears it.
  };

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
        setHighlightedIndex(0);
        return;
      }
      if (escapeAction) onResolve(escapeAction);
      return;
    }

    if (commandMode) {
      if (key.return) {
        const submittedInput = commandEditor.getValue();
        const submittedTitles =
          submittedInput === commandInput
            ? titleMatches
            : matchLocalTitles(titleEntries, submittedInput);
        const row = resolveHighlightedPaletteRow(
          submittedInput,
          commands,
          submittedTitles,
          submittedInput === commandInput ? highlightedIndex : 0,
        );
        // Commands keep precedence over JUMP TO title rows: a palette Enter on
        // a command is also the "long way" signal contextual tips key off.
        if (row?.kind === "command" && row.command.enabled) {
          setCommandMode(false);
          setCommandInput("");
          setHighlightedIndex(0);
          onPaletteCommand?.(row.command.id);
          onResolve(toShellAction(row.command.id));
          return;
        }
        if (row?.kind === "title") {
          setCommandMode(false);
          setCommandInput("");
          setHighlightedIndex(0);
          onTitlePick?.(row.match.entry);
          return;
        }
        return;
      }
      if (key.tab) {
        const target = getCommandAutocompleteTarget(commandInput, commands, highlightedIndex);
        if (target) {
          commandEditor.setValue(target.aliases[0] ?? target.id);
          const model = buildCommandPickerModel(commandInput, commands, highlightedIndex);
          const targetIndex = model.options.findIndex((option) => option.value === target.id);
          setHighlightedIndex(Math.max(0, targetIndex));
        }
        return;
      }
      const selectable = paletteSelectableCount(commandInput, commands, titleMatches);
      if (key.upArrow) {
        setHighlightedIndex((current) => movePaletteSelection(selectable, current, -1));
        return;
      }
      if (key.downArrow) {
        setHighlightedIndex((current) => movePaletteSelection(selectable, current, 1));
        return;
      }
      if (commandEditor.handleInput(input, key)) {
        return;
      }
      return;
    }

    if (route.command === "open-command-palette" && commands.length > 0) {
      openCommandPalette();
      return;
    }

    const matchKey = input.toLowerCase();
    const footerAction = footerActions.find(
      (action) => action.key === matchKey && !action.disabled,
    );
    if (footerAction) {
      if (footerAction.action === "command-mode") {
        openCommandPalette();
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

  return {
    commandMode,
    commandInput,
    commandCursor: commandEditor.cursor,
    highlightedIndex,
    titleMatches,
  };
}
