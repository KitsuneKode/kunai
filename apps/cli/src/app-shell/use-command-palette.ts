// =============================================================================
// use-command-palette.ts — shared command-palette state + key choreography
//
// The palette is modal: while open it owns every keystroke (edit the query,
// move the highlight, tab-autocomplete, enter to resolve, esc to close), so
// callers run `handleKey` first and continue only on "ignored". The state trio
// (open / input / highlightedIndex) plus the line editor used to be hand-rolled
// identically in browse-shell and ink-shell — including six copies of the
// open/close triple-write. One hook owns it now; each shell still decides what
// a resolved command means via the returned intent.
// =============================================================================

import { useLineEditor, type LineEditorKey } from "@/app-shell/line-editor";
import { useCallback, useState } from "react";

import type { ResolvedAppCommand } from "./commands";
import {
  describePaletteRefusal,
  getCommandAutocompleteTarget,
  getCommandMatches,
  getHighlightedCommand,
} from "./shell-command-model";

export type CommandPaletteKeyResult =
  | { readonly kind: "resolved"; readonly command: ResolvedAppCommand }
  /** The palette ate the key — the caller must not run its own handling. */
  | { readonly kind: "consumed" }
  /** Palette is closed; the caller's normal key handling continues. */
  | { readonly kind: "ignored" };

export function useCommandPalette(options?: { readonly onInputRedraw?: () => void }) {
  const [state, setState] = useState({ open: false, input: "", highlightedIndex: 0 });
  // Enter on a disabled command must name the refusal — a silent consume reads
  // as a dead key. The notice lives until the next palette keypress.
  const [notice, setNotice] = useState<string | null>(null);

  const editor = useLineEditor({
    value: state.input,
    onChange: (nextValue) =>
      setState((current) => ({ ...current, input: nextValue, highlightedIndex: 0 })),
    onRedraw: options?.onInputRedraw,
  });

  // Stable identities: callers put these in useCallback/useEffect dep arrays.
  const openPalette = useCallback(() => {
    setNotice(null);
    setState({ open: true, input: "", highlightedIndex: 0 });
  }, []);
  const closePalette = useCallback(() => {
    setNotice(null);
    setState((current) =>
      current.open ? { open: false, input: "", highlightedIndex: 0 } : current,
    );
  }, []);

  const handleKey = useCallback(
    (
      input: string,
      key: LineEditorKey,
      commands: readonly ResolvedAppCommand[],
    ): CommandPaletteKeyResult => {
      if (!state.open) return { kind: "ignored" };
      const matches = getCommandMatches(state.input, commands);

      if (key.escape) {
        closePalette();
        return { kind: "consumed" };
      }
      if (key.return) {
        const resolved = getHighlightedCommand(state.input, commands, state.highlightedIndex);
        // A disabled highlighted command still consumes the keypress — Enter on a
        // greyed row refuses with a notice, not a fallthrough to the surface beneath.
        if (!resolved?.enabled) {
          setNotice(describePaletteRefusal(resolved));
          return { kind: "consumed" };
        }
        return { kind: "resolved", command: resolved };
      }
      setNotice(null);
      if (key.tab) {
        const target = getCommandAutocompleteTarget(state.input, commands, state.highlightedIndex);
        if (target) {
          editor.setValue(target.aliases[0] ?? target.id);
          const nextIndex = matches.findIndex((candidate) => candidate.id === target.id);
          setState((current) => ({
            ...current,
            highlightedIndex: nextIndex >= 0 ? nextIndex : 0,
          }));
        }
        return { kind: "consumed" };
      }
      if (key.upArrow && matches.length > 0) {
        setState((current) => ({
          ...current,
          highlightedIndex: (current.highlightedIndex - 1 + matches.length) % matches.length,
        }));
        return { kind: "consumed" };
      }
      if (key.downArrow && matches.length > 0) {
        setState((current) => ({
          ...current,
          highlightedIndex: (current.highlightedIndex + 1) % matches.length,
        }));
        return { kind: "consumed" };
      }
      editor.handleInput(input, key);
      return { kind: "consumed" };
    },
    [state, editor, closePalette],
  );

  return {
    open: state.open,
    input: state.input,
    cursor: editor.cursor,
    highlightedIndex: state.highlightedIndex,
    notice,
    openPalette,
    closePalette,
    editor,
    handleKey,
  };
}
