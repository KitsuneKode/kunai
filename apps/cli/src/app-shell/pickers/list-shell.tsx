import { useLineEditor } from "@/app-shell/line-editor";
import { defaultPaletteSelectionIndex } from "@/app-shell/palette-ranking";
import {
  listShellOptionKey,
  resolveArmedListOption,
  resolveCompactListShortcut,
  shouldShowListFilter,
} from "@/app-shell/pickers/list-shell-filter";
import type {
  ListShellActionContext,
  ListShellFilterPreference,
  ShellOption,
} from "@/app-shell/pickers/list-shell-types";
import { requestAppShutdown } from "@/app/session/shutdown-request";
import { matchLocalTitles, type LocalTitleEntry } from "@/domain/palette/local-title-index";
import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useState } from "react";

import { resolveEscStack, type EscLayer } from "../esc-stack";
import { useSettledValue } from "../hooks/use-settled-value";
import { getPickerChromeRows, getPickerLayout, getPickerListMaxVisible } from "../layout-policy";
import { plainModeEnabled, selectionPrefix } from "../plain-mode";
import { suppressPosterWhileNavigating } from "../poster-types";
import { ConfirmStrip } from "../primitives/ConfirmStrip";
import {
  confirmStripFooterActions,
  confirmStripKeyDecision,
  confirmStripOwnsInput,
} from "../primitives/ConfirmStrip.model";
import { SakuraPetal } from "../primitives/SakuraPetal";
import { useConfirmStripController } from "../primitives/use-confirm-strip";
import { mountRootContent } from "../root-content-state";
import {
  getCommandAutocompleteTarget,
  getCommandMatches,
  getListShellCommandPaletteMaxVisible,
  movePaletteSelection,
  paletteSelectableCount,
  resolveHighlightedPaletteRow,
  shouldHideCompanionForCommandPalette,
} from "../shell-command-model";
import { CommandPalette } from "../shell-command-ui";
import { InputField } from "../shell-frame";
import { LocalSection, ResizeBlocker, ShellFooter } from "../shell-primitives";
import { clearShellScreenArtifacts } from "../shell-screen-clear";
import { getWindowStart, padColumnsEnd, truncateLine, wrapText } from "../shell-text";
import { palette } from "../shell-theme";
import { PosterOutput } from "../SixelPosterPane";
import { toShellAction, type FooterAction, type ShellAction, type ShellFooterMode } from "../types";
import { usePosterPreview } from "../use-poster-preview";
import { useDebouncedViewportPolicy } from "../use-viewport-policy";

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
  filter = "auto",
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
  filter?: ListShellFilterPreference;
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
  const filterVisible = shouldShowListFilter(filter, options.length);
  const normalizedFilter = filterVisible ? filterQuery.trim().toLowerCase() : "";
  const filteredOptions = useMemo(() => {
    return options.filter((option) => {
      if (normalizedFilter.length === 0) return true;
      const haystack = `${option.label} ${option.detail ?? ""}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [options, normalizedFilter]);

  const visibleConfirmationIds = useMemo(
    () =>
      filteredOptions.flatMap((option) => {
        const key = listShellOptionKey(option);
        return key === null ? [] : [key];
      }),
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
      : (actionContext?.taskLabel ??
        (filterVisible ? "Filter this list and confirm a selection" : "Choose an action"));
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
      setHighlightedCommandIndex(
        defaultPaletteSelectionIndex(
          nextValue,
          actionContext?.commands ?? [],
          matchLocalTitles(titleEntries, nextValue),
        ),
      );
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
    const confirmState = confirm.getState();
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestAppShutdown({ reason: "SIGINT", exitCode: 130 });
    }

    if (key.escape) {
      const layers: EscLayer[] = [
        ...(confirmState.kind !== "idle" ? [{ kind: "confirm" } as const] : []),
        ...(commandMode
          ? [{ kind: "prompt" } as const]
          : [{ kind: "filter", query: filterQuery } as const, { kind: "picker" } as const]),
      ];
      const action = resolveEscStack(layers);
      if (action === "cancel-confirmation") confirm.transition({ type: "cancel" });
      if (action === "cancel-prompt") {
        // Close only — the draft survives so a `/` reopen resumes the query.
        setCommandMode(false);
        setHighlightedCommandIndex(0);
      }
      if (action === "clear-filter") setFilterQuery("");
      if (action === "cancel-picker") onCancel();
      return;
    }

    const confirmDecision = confirmStripKeyDecision(confirmState.kind, input, key, {
      continueOnVerticalArrows: true,
    });
    if (confirmDecision === "execute") {
      const confirmation = confirm.transition({ type: "confirm" });
      const resolved = resolveArmedListOption(filteredOptions, confirmation.effect?.targetId);
      if (resolved.kind === "one") {
        setConfirmed(true);
        setTimeout(() => onSubmit(resolved.option.value), 150);
      } else {
        confirm.transition({
          type: "fail",
          message:
            resolved.kind === "ambiguous"
              ? "That confirmation matches more than one row"
              : "That row is no longer visible",
        });
      }
      return;
    }
    if (confirmDecision === "cancel") {
      confirm.transition({ type: "cancel" });
      return;
    }
    if (confirmDecision === "cancel-and-continue") confirm.transition({ type: "cancel" });
    if (confirmDecision === "hold") return;

    if (commandMode) {
      const matches = getCommandMatches(commandInput, actionContext?.commands ?? []);

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

    if (!filterVisible && /^[\p{L}\p{N}]$/u.test(input) && !key.ctrl && !key.meta) {
      const shortcutIndex = resolveCompactListShortcut(input, filteredOptions);
      const shortcutOption = shortcutIndex === null ? undefined : filteredOptions[shortcutIndex];
      if (shortcutIndex !== null && shortcutOption && !confirmed) {
        setIndex(shortcutIndex);
        if (shortcutOption.destructive) {
          const targetId = listShellOptionKey(shortcutOption);
          const armed = targetId ? resolveArmedListOption(filteredOptions, targetId) : null;
          if (targetId && armed?.kind === "one") {
            confirm.transition({
              type: "arm",
              targetId,
              label: shortcutOption.label,
              verb: shortcutOption.confirmVerb ?? "confirm",
              executingLabel: `Applying ${shortcutOption.label}`,
              visibleIds: visibleConfirmationIds,
            });
          }
        } else {
          setConfirmed(true);
          setTimeout(() => onSubmit(shortcutOption.value), 150);
        }
      }
      return;
    }

    if (key.return) {
      const selected = filteredOptions[index];
      if (selected && !confirmed) {
        if (selected.destructive) {
          const targetId = listShellOptionKey(selected);
          const armed = targetId ? resolveArmedListOption(filteredOptions, targetId) : null;
          if (!targetId || armed?.kind !== "one") return;
          confirm.transition({
            type: "arm",
            targetId,
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
        {filterVisible ? (
          <InputField
            label="Filter"
            value={filterQuery}
            onChange={updateFilterQuery}
            placeholder="Type to narrow this list"
            focus={!commandMode}
            ignoreInput={() => confirmStripOwnsInput(confirm.getState())}
            hint={actionContext ? "Type to filter · / opens commands" : undefined}
            onRedraw={clearShellScreenArtifacts}
          />
        ) : null}
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
                  const shortcutHint = filterVisible
                    ? ""
                    : (option.shortcut ??
                      `${filteredOptions.indexOf(option) + 1 <= 9 ? filteredOptions.indexOf(option) + 1 : ""}`);
                  const detailWithShortcut = [option.detail, shortcutHint]
                    .filter(Boolean)
                    .join("  ");
                  const secondary = detailWithShortcut
                    ? `  ${truncateLine(detailWithShortcut, Math.max(12, rowWidth - option.label.length - 4))}`
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

export function openListShell<T>({
  title,
  subtitle,
  options,
  initialFilter,
  initialSelectedIndex,
  actionContext,
  filter = "auto",
}: {
  title: string;
  subtitle: string;
  options: readonly ShellOption<T>[];
  initialFilter?: string;
  initialSelectedIndex?: number;
  actionContext?: ListShellActionContext;
  filter?: ListShellFilterPreference;
}): Promise<T | null> {
  let filterQuery = initialFilter ?? "";
  let selectedIndex = initialSelectedIndex ?? 0;

  const run = async (): Promise<T | null> => {
    while (true) {
      const session = mountRootContent<ListShellSubmitResult<T>>({
        kind: "picker",
        headerLabel: title,
        renderContent: (finish) => (
          <ListShell
            title={title}
            subtitle={subtitle}
            options={options}
            initialFilter={filterQuery}
            initialSelectedIndex={selectedIndex}
            actionContext={actionContext}
            filter={filter}
            onSubmit={(value) => finish({ type: "selected", value })}
            onCancel={() => finish({ type: "cancelled" })}
            onAction={(action) => finish(action)}
          />
        ),
        fallbackValue: { type: "cancelled" },
      });

      const result = await session.result;
      if (result.type === "selected") return result.value;
      if (result.type === "cancelled") return null;

      const actionResult = await Promise.resolve(
        actionContext?.onAction(result.action) ?? "unhandled",
      );
      if (actionResult === "quit") {
        requestAppShutdown({ reason: "shell-quit", exitCode: 0 });
      }
      filterQuery = result.filterQuery;
      selectedIndex = result.selectedIndex;
    }
  };

  return run();
}
