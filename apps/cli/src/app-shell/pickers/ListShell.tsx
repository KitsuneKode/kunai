import { useSettledValue } from "@/app-shell/hooks/use-settled-value";
import {
  getPickerChromeRows,
  getPickerLayout,
  getPickerListMaxVisible,
} from "@/app-shell/layout-policy";
import { useLineEditor } from "@/app-shell/line-editor";
import { plainModeEnabled, selectionPrefix } from "@/app-shell/plain-mode";
import { suppressPosterWhileNavigating } from "@/app-shell/poster-types";
import {
  getCommandAutocompleteTarget,
  getCommandMatches,
  getListShellCommandPaletteMaxVisible,
  movePaletteSelection,
  paletteSelectableCount,
  resolveHighlightedPaletteRow,
  shouldHideCompanionForCommandPalette,
} from "@/app-shell/shell-command-model";
import { CommandPalette } from "@/app-shell/shell-command-ui";
import { InputField } from "@/app-shell/shell-frame";
import { clearShellScreenArtifacts } from "@/app-shell/shell-screen-clear";
import { getWindowStart, padColumnsEnd, truncateLine, wrapText } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import {
  toShellAction,
  type FooterAction,
  type ShellAction,
  type ShellFooterMode,
} from "@/app-shell/types";
import { usePosterPreview } from "@/app-shell/use-poster-preview";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import { requestAppShutdown } from "@/app/session/shutdown-request";
import { matchLocalTitles, type LocalTitleEntry } from "@/domain/palette/local-title-index";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

import { ConfirmStrip } from "../primitives/ConfirmStrip";
import { confirmStripFooterActions, confirmStripOwnsInput } from "../primitives/ConfirmStrip.model";
import { SakuraPetal } from "../primitives/SakuraPetal";
import { useConfirmStripController } from "../primitives/use-confirm-strip";
import { LocalSection, ResizeBlocker, ShellFooter } from "../shell-primitives";
import { PosterOutput } from "../SixelPosterPane";
import type { ListShellActionContext, ShellOption } from "./list-shell-types";

const LIST_SHELL_FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "/", label: "commands", action: "command-mode" },
  { key: "esc", label: "back", action: "quit" },
];

export type ListShellActionResult = {
  type: "action";
  action: ShellAction;
  filterQuery: string;
  selectedIndex: number;
};

export type ListShellSubmitResult<T> =
  | { type: "selected"; value: T }
  | { type: "cancelled" }
  | ListShellActionResult;

const EMPTY_TITLE_ENTRIES: readonly LocalTitleEntry[] = [];

function listShellOptionKey<T>(option: ShellOption<T>): string {
  return option.id ?? option.label;
}

function normalizeReservedCommandInput(nextValue: string) {
  if (!nextValue.includes("/")) {
    return { value: nextValue, openCommandPalette: false };
  }

  return {
    value: nextValue.replaceAll("/", ""),
    openCommandPalette: true,
  };
}

export function ListShell<T>({
  title,
  subtitle,
  options,
  initialFilter,
  initialSelectedIndex,
  actionContext,
  onSubmit,
  onCancel,
  onAction,
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  initialFilter?: string;
  initialSelectedIndex?: number;
  actionContext?: ListShellActionContext;
  onSubmit: (value: T) => void;
  onCancel: () => void;
  onAction?: (result: ListShellActionResult) => void;
}) {
  const [index, setIndex] = useState(initialSelectedIndex ?? 0);
  const [confirmed, setConfirmed] = useState(false);
  const confirm = useConfirmStripController();
  const [filterQuery, setFilterQuery] = useState(initialFilter ?? "");
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedCommandIndex, setHighlightedCommandIndex] = useState(0);
  const [titleEntries, setTitleEntries] = useState<readonly LocalTitleEntry[]>([]);
  const titleMatches = useMemo(
    () => matchLocalTitles(titleEntries, commandInput),
    [titleEntries, commandInput],
  );
  const viewport = useDebouncedViewportPolicy("picker");
  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    return options.filter((option) => {
      if (normalizedFilter.length === 0) return true;
      const haystack = `${option.label} ${option.detail ?? ""}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [options, normalizedFilter]);

  const visibleConfirmationIds = useMemo(
    () => filteredOptions.map((option) => listShellOptionKey(option)),
    [filteredOptions],
  );

  useEffect(() => {
    confirm.transition({ type: "reconcile", visibleIds: visibleConfirmationIds });
  }, [confirm, visibleConfirmationIds]);

  useEffect(() => {
    if (filteredOptions.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, filteredOptions.length - 1));
  }, [filteredOptions.length]);

  const selectedOption = filteredOptions[index];
  // Label/detail stay live (cheap text) so the highlight reads instantly; only the
  // heavy poster pipeline is gated on the settled selection so a run of ↑/↓ never
  // spawns a chafa/Kitty subprocess mid-navigation.
  const settledOption = useSettledValue(selectedOption);
  const navigating = selectedOption !== settledOption;

  const { ultraCompact, tooSmall, minColumns, minRows } = viewport;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({
      hasSubtitle: subtitle.length > 0,
      commandMode,
    }),
  );
  const pickerLayout = getPickerLayout(viewport.columns, viewport.rows);
  const {
    innerWidth,
    listWidth,
    companionWidth,
    rowWidth,
    showCompanion: showSelectionCompanion,
  } = pickerLayout;
  const showCompanion =
    showSelectionCompanion && !shouldHideCompanionForCommandPalette(commandMode);
  const selectedLabel = selectedOption?.label ?? "Nothing selected";
  const selectedDetail =
    selectedOption?.detail ??
    (filteredOptions.length > 0
      ? "Use ↑↓ to move through results"
      : "No matching results. Keep typing or press Esc to clear the filter.");
  const detailLines = wrapText(selectedDetail, Math.max(20, companionWidth - 2), 7);
  const { poster, spinner: posterSpinner } = usePosterPreview(settledOption?.previewImageUrl, {
    rows: 9,
    cols: Math.max(18, Math.min(30, companionWidth - 4)),
    enabled: showCompanion && Boolean(settledOption?.previewImageUrl),
    // `settledOption` already absorbs the rapid-navigation burst; the hook only
    // needs a tiny guard on top rather than re-debouncing.
    debounceMs: 16,
    placementSlot: "browse-preview",
  });
  // Sixel must be unregistered while the selection is moving; otherwise each
  // Ink commit repaints the previous title through ConPTY. Kitty owns an
  // independent placement and can remain until the settled selection replaces it.
  const showHeavyPoster =
    poster.kind !== "none" && !(navigating && suppressPosterWhileNavigating(poster));

  const windowStart = getWindowStart(index, filteredOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, filteredOptions.length);
  const visibleOptions = filteredOptions.slice(windowStart, windowEnd);
  const footerTask =
    normalizedFilter.length > 0
      ? "Refine the filter or confirm the highlighted match"
      : (actionContext?.taskLabel ?? "Filter this list and confirm a selection");
  // List/picker shells use the minimal footer: the surface is a focused filter +
  // select, and the command palette ("/") plus Esc-back are the only chrome.
  const effectiveFooterMode: ShellFooterMode = "minimal";
  const footerActions = confirmStripOwnsInput(confirm.state)
    ? confirmStripFooterActions(confirm.state)
    : LIST_SHELL_FOOTER_ACTIONS;

  // Snapshot title entries once per open — the matcher is a pure in-memory
  // index against this list, so a keystroke never hits storage.
  const openPalette = () => {
    setTitleEntries(actionContext?.localTitles?.() ?? EMPTY_TITLE_ENTRIES);
    setCommandMode(true);
    setHighlightedCommandIndex(0);
    // commandInput deliberately survives close/reopen — `/` keeps the draft.
  };

  const updateFilterQuery = (nextValue: string) => {
    const normalized = normalizeReservedCommandInput(nextValue);
    setFilterQuery(normalized.value);
    if (normalized.openCommandPalette && actionContext) {
      openPalette();
    }
  };
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedCommandIndex(0);
    },
  });

  function activateListPalette(selectionIndex: number) {
    const row = resolveHighlightedPaletteRow(
      commandInput,
      actionContext?.commands ?? [],
      titleMatches,
      selectionIndex,
    );
    if (row?.kind === "command" && row.command.enabled) {
      setCommandMode(false);
      setCommandInput("");
      onAction?.({
        type: "action",
        action: toShellAction(row.command.id),
        filterQuery,
        selectedIndex: index,
      });
    }
    if (row?.kind === "title") {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedCommandIndex(0);
      actionContext?.onTitlePick?.(row.match.entry);
    }
  }

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestAppShutdown({ reason: "SIGINT", exitCode: 130 });
    }

    if (confirm.state.kind !== "idle") {
      if (confirm.state.kind === "executing") return;
      if (key.escape) {
        confirm.transition({ type: "cancel" });
        return;
      }
      if (confirm.state.kind === "armed" && input.toLowerCase() === "y") {
        const confirmation = confirm.transition({ type: "confirm" });
        const targetId = confirmation.effect?.targetId;
        const selected = filteredOptions.find((option) => listShellOptionKey(option) === targetId);
        if (selected) {
          confirm.transition({ type: "succeed" });
          setConfirmed(true);
          setTimeout(() => onSubmit(selected.value), 150);
        } else {
          confirm.transition({ type: "fail", message: "That row is no longer visible" });
        }
        return;
      }
      if (key.upArrow || key.downArrow) confirm.transition({ type: "cancel" });
      return;
    }

    if (commandMode) {
      const matches = getCommandMatches(commandInput, actionContext?.commands ?? []);

      if (key.escape) {
        // Close only — the draft survives so a `/` reopen resumes the query.
        setCommandMode(false);
        setHighlightedCommandIndex(0);
        return;
      }
      if (key.return) {
        activateListPalette(highlightedCommandIndex);
        return;
      }
      if (key.tab) {
        const target = getCommandAutocompleteTarget(
          commandInput,
          actionContext?.commands ?? [],
          highlightedCommandIndex,
        );
        if (target) {
          commandEditor.setValue(target.aliases[0] ?? target.id);
          const nextIndex = matches.findIndex((candidate) => candidate.id === target.id);
          setHighlightedCommandIndex(nextIndex >= 0 ? nextIndex : 0);
        }
        return;
      }
      const selectable = paletteSelectableCount(
        commandInput,
        actionContext?.commands ?? [],
        titleMatches,
      );
      if (key.upArrow) {
        setHighlightedCommandIndex((current) => movePaletteSelection(selectable, current, -1));
        return;
      }
      if (key.downArrow) {
        setHighlightedCommandIndex((current) => movePaletteSelection(selectable, current, 1));
        return;
      }
      if (commandEditor.handleInput(input, key)) {
        return;
      }
      return;
    }

    if (input === "/" && actionContext) {
      openPalette();
      return;
    }

    if (key.escape) {
      if (filterQuery.length > 0) {
        setFilterQuery("");
        return;
      }
      onCancel();
      return;
    }
    if (key.return) {
      const selected = filteredOptions[index];
      if (selected && !confirmed) {
        if (selected.destructive) {
          confirm.transition({
            type: "arm",
            targetId: listShellOptionKey(selected),
            label: selected.label,
            verb: selected.confirmVerb ?? "confirm",
            executingLabel: `Applying ${selected.label}`,
            visibleIds: visibleConfirmationIds,
          });
          return;
        }
        setConfirmed(true);
        setTimeout(() => onSubmit(selected.value), 150);
      }
      return;
    }
    if (key.upArrow && filteredOptions.length > 0) {
      setIndex((current) => (current - 1 + filteredOptions.length) % filteredOptions.length);
      return;
    }
    if (key.downArrow && filteredOptions.length > 0) {
      setIndex((current) => (current + 1) % filteredOptions.length);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box flexDirection="column">
          <Text bold color={confirmed ? palette.ok : palette.text}>
            {confirmed ? "Selected" : title}
          </Text>
          <Text color={palette.muted}>{confirmed ? selectedLabel : subtitle}</Text>
        </Box>
        <InputField
          label="Filter"
          value={filterQuery}
          onChange={updateFilterQuery}
          placeholder="Type to narrow this list"
          focus={!commandMode}
          hint={actionContext ? "Type to filter · / opens commands" : undefined}
          onRedraw={clearShellScreenArtifacts}
        />
        {tooSmall ? (
          <ResizeBlocker
            columns={viewport.columns}
            rows={viewport.rows}
            minColumns={minColumns}
            minRows={minRows}
          />
        ) : (
          <>
            <Text color={palette.dim} dimColor>
              {`${filteredOptions.length > 0 ? index + 1 : 0} of ${filteredOptions.length}`}
            </Text>
            <Box
              flexDirection={showCompanion && !plainModeEnabled() ? "row" : "column"}
              marginTop={1}
              justifyContent="space-between"
            >
              <Box
                flexDirection="column"
                width={showCompanion && !plainModeEnabled() ? listWidth : undefined}
              >
                {windowStart > 0 && (
                  <Text color={palette.dim}>
                    {plainModeEnabled() ? "More items above" : " ▲ ..."}
                  </Text>
                )}
                {visibleOptions.map((option) => {
                  const plain = plainModeEnabled();
                  const selected = option === selectedOption;
                  const isConfirmed = confirmed && selected;
                  const itemPrefix = plain
                    ? isConfirmed
                      ? "[confirmed] "
                      : selectionPrefix(selected, true)
                    : isConfirmed
                      ? "✓"
                      : selected
                        ? "▌"
                        : " ";
                  // Availability and consequence have to be legible before the
                  // pick. An unavailable row used to look identical to a live
                  // one, and a row that discards data looked like a row that
                  // plays something -- both only revealed themselves after
                  // being chosen.
                  const itemTone = isConfirmed
                    ? palette.ok
                    : option.disabled
                      ? palette.dim
                      : selected
                        ? option.destructive
                          ? palette.warn
                          : palette.accent
                        : option.destructive
                          ? palette.warnDim
                          : palette.dim;
                  const secondary = option.detail
                    ? `  ${truncateLine(option.detail, Math.max(12, rowWidth - option.label.length - 4))}`
                    : "";
                  const rowText = truncateLine(`${option.label}${secondary}`, rowWidth - 2);
                  const highlighted = selected && !option.disabled;
                  const rowColor = option.disabled
                    ? palette.textDim
                    : option.destructive
                      ? selected
                        ? palette.warn
                        : palette.warnDim
                      : selected || isConfirmed
                        ? palette.text
                        : palette.textDim;
                  return (
                    <Box
                      key={`${option.label}-${option.detail ?? ""}`}
                      width={rowWidth}
                      backgroundColor={
                        highlighted
                          ? option.destructive
                            ? palette.warnFill
                            : palette.accentFill
                          : undefined
                      }
                    >
                      <Text
                        color={rowColor}
                        bold={highlighted || isConfirmed}
                        dimColor={option.disabled || (!selected && !isConfirmed)}
                      >
                        <Text color={itemTone}>{`${itemPrefix} `}</Text>
                        {padColumnsEnd(rowText, rowWidth - 2)}
                      </Text>
                    </Box>
                  );
                })}
                {windowEnd < filteredOptions.length && <Text color={palette.dim}> ▼ ...</Text>}
              </Box>
              {!ultraCompact && showCompanion ? (
                <Box marginLeft={2} flexDirection="column" width={companionWidth}>
                  <LocalSection title="Current Selection" tone="success" marginTop={0}>
                    {showHeavyPoster ? (
                      <Box flexDirection="column" marginBottom={1}>
                        <PosterOutput poster={poster} />
                      </Box>
                    ) : selectedOption?.previewImageUrl && posterSpinner && !navigating ? (
                      // Only a settled selection whose artwork genuinely missed
                      // the cache earns the petal — spinning while `navigating`
                      // put a loading state on every ↑/↓ through the list.
                      <Box marginBottom={1}>
                        <SakuraPetal mode="loading" />
                      </Box>
                    ) : null}
                    <Text bold color={palette.text}>
                      {truncateLine(selectedLabel, companionWidth)}
                    </Text>
                    <Box marginTop={1} flexDirection="column">
                      {detailLines.map((line) => (
                        <Text key={`detail-${selectedLabel}-${line}`} color={palette.muted}>
                          {line}
                        </Text>
                      ))}
                    </Box>
                  </LocalSection>
                </Box>
              ) : null}
            </Box>
          </>
        )}
      </Box>

      {commandMode && actionContext ? (
        <CommandPalette
          pointer={{
            select: setHighlightedCommandIndex,
            activate: activateListPalette,
            close: () => {
              setCommandMode(false);
              setHighlightedCommandIndex(0);
            },
          }}
          input={commandInput}
          cursor={commandEditor.cursor}
          commands={actionContext.commands}
          highlightedIndex={highlightedCommandIndex}
          titleMatches={titleMatches}
          maxVisible={getListShellCommandPaletteMaxVisible(
            viewport.rows,
            subtitle.split("\n").length,
          )}
          width={innerWidth}
        />
      ) : null}
      <ConfirmStrip state={confirm.state} width={innerWidth} />
      <ShellFooter
        taskLabel={`${footerTask}  ·  ${subtitle}`}
        actions={footerActions}
        mode={effectiveFooterMode}
        commandMode={commandMode}
      />
    </Box>
  );
}
