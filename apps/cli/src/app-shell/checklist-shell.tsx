import {
  getPickerChromeRows,
  getPickerLayout,
  getPickerListMaxVisible,
} from "@/app-shell/layout-policy";
import { useLineEditor } from "@/app-shell/line-editor";
import { MouseTarget } from "@/app-shell/mouse/MouseRegions";
import { plainCheckboxText, plainModeEnabled, selectionPrefix } from "@/app-shell/plain-mode";
import { mountRootContent } from "@/app-shell/root-content-state";
import { LineEditorText } from "@/app-shell/shell-command-ui";
import { ShellFooter, ResizeBlocker } from "@/app-shell/shell-primitives";
import { getWindowStart, truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import { requestAppShutdown } from "@/app/session/shutdown-request";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useRef, useState } from "react";

export type ListOption<T> = {
  value: T;
  label: string;
  detail?: string;
};

/**
 * Toggle all currently visible options without losing selections outside the
 * active filter. If every visible option is already checked, uncheck those
 * visible options; otherwise check every visible option.
 */
export function toggleVisibleChecklistSelection<T>(
  selected: ReadonlySet<T>,
  visibleOptions: readonly ListOption<T>[],
): Set<T> {
  const next = new Set(selected);
  if (visibleOptions.length === 0) return next;
  const allVisibleSelected = visibleOptions.every((option) => next.has(option.value));
  for (const option of visibleOptions) {
    if (allVisibleSelected) next.delete(option.value);
    else next.add(option.value);
  }
  return next;
}

export function formatChecklistSelectionCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

/** Exported for tests; callers mount it through `openChecklistShell`. */
export function ChecklistShell<T>({
  title,
  subtitle,
  options,
  initialFilter,
  initialSelectedIndex,
  onSubmit,
  onCancel,
}: {
  title: string;
  subtitle: string;
  options: readonly ListOption<T>[];
  initialFilter?: string;
  initialSelectedIndex?: number;
  onSubmit: (values: T[]) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(initialSelectedIndex ?? 0);
  const [confirmed, setConfirmed] = useState(false);
  const [filterQuery, setFilterQuery] = useState(initialFilter ?? "");
  const [selectedSet, setSelectedSet] = useState<Set<T>>(new Set());

  // The confirm flash defers onSubmit so the checkmark is visible. If the shell
  // unmounts inside that window (Ctrl-C, route change), the pending callback
  // must not fire into a torn-down tree.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  const viewport = useDebouncedViewportPolicy("picker");
  const normalizedFilter = filterQuery.trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    return options.filter((option) => {
      if (normalizedFilter.length === 0) return true;
      const haystack = `${option.label} ${option.detail ?? ""}`.toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [options, normalizedFilter]);

  useEffect(() => {
    if (filteredOptions.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((current) => Math.min(current, filteredOptions.length - 1));
  }, [filteredOptions.length]);

  const selectedOption = filteredOptions[index];

  const { tooSmall, minColumns, minRows } = viewport;
  const maxVisible = getPickerListMaxVisible(
    viewport.rows,
    getPickerChromeRows({ hasSubtitle: false, commandMode: false }),
  );
  const pickerLayout = getPickerLayout(viewport.columns, viewport.rows);
  const { listWidth, rowWidth, showCompanion: showSelectionCompanion } = pickerLayout;

  const windowStart = getWindowStart(index, filteredOptions.length, maxVisible);
  const windowEnd = Math.min(windowStart + maxVisible, filteredOptions.length);
  const visibleOptions = filteredOptions.slice(windowStart, windowEnd);

  const filterEditor = useLineEditor({
    value: filterQuery,
    onChange: setFilterQuery,
  });

  const toggleOption = (option: ListOption<T>) =>
    setSelectedSet((current) => {
      const next = new Set(current);
      if (next.has(option.value)) next.delete(option.value);
      else next.add(option.value);
      return next;
    });
  // Enter and the footer's confirm tap: the checked set, or the cursor row.
  const confirmSelection = () => {
    if (confirmed) return;
    const valuesToSubmit =
      selectedSet.size > 0
        ? Array.from(selectedSet)
        : filteredOptions[index]
          ? [filteredOptions[index].value]
          : [];
    if (valuesToSubmit.length === 0) return;
    setConfirmed(true);
    confirmTimer.current = setTimeout(() => {
      onSubmit(valuesToSubmit);
    }, 150);
  };
  const toggleAllVisible = () =>
    setSelectedSet((current) => toggleVisibleChecklistSelection(current, filteredOptions));

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestAppShutdown({ reason: "SIGINT", exitCode: 130 });
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
    if (key.upArrow && filteredOptions.length > 0) {
      setIndex((current) => (current - 1 + filteredOptions.length) % filteredOptions.length);
      return;
    }
    if (key.downArrow && filteredOptions.length > 0) {
      setIndex((current) => (current + 1) % filteredOptions.length);
      return;
    }
    if (input === "a" && key.ctrl) {
      toggleAllVisible();
      return;
    }
    if (input === " " && !filterQuery) {
      const selected = filteredOptions[index];
      if (selected) toggleOption(selected);
      return;
    }
    if (key.return) {
      confirmSelection();
      return;
    }
    filterEditor.handleInput(input, key);
  });

  const confirmedCount = selectedSet.size > 0 ? selectedSet.size : selectedOption ? 1 : 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Text color={confirmed ? palette.ok : palette.text} bold>
            {confirmed ? "Selected" : title}
          </Text>
          <Text color={palette.muted}>
            {confirmed ? formatChecklistSelectionCount(confirmedCount) : subtitle}
          </Text>
        </Box>
        <Box paddingY={plainModeEnabled() ? 0 : 1}>
          <Text color={palette.accent}>{plainModeEnabled() ? "Filter (focused): " : "⌕ "}</Text>
          <LineEditorText
            value={filterQuery}
            cursor={filterEditor.cursor}
            focused={true}
            placeholder="type to filter"
            maxWidth={Math.max(20, rowWidth - 6)}
          />
        </Box>
        {tooSmall ? (
          <ResizeBlocker
            columns={viewport.columns}
            rows={viewport.rows}
            minColumns={minColumns}
            minRows={minRows}
          />
        ) : (
          <>
            <Box
              flexDirection={showSelectionCompanion && !plainModeEnabled() ? "row" : "column"}
              marginTop={1}
              justifyContent="space-between"
            >
              <Box
                flexDirection="column"
                width={showSelectionCompanion && !plainModeEnabled() ? listWidth : undefined}
              >
                {filteredOptions.length === 0 && (
                  <Text color={palette.muted}>No matching items</Text>
                )}
                {windowStart > 0 && (
                  <Text color={palette.dim}>
                    {plainModeEnabled() ? "More items above" : " ▲ ..."}
                  </Text>
                )}
                {visibleOptions.map((option, visibleIndex) => {
                  const plain = plainModeEnabled();
                  const highlighted = option === selectedOption;
                  const isChecked = selectedSet.has(option.value);
                  const isConfirmed = confirmed && isChecked;
                  const itemPrefix = plainCheckboxText(isChecked, plain);
                  const itemTone = isConfirmed
                    ? palette.ok
                    : highlighted
                      ? palette.accent
                      : isChecked
                        ? palette.ok
                        : palette.dim;
                  const secondary = option.detail
                    ? `  ${truncateLine(option.detail, Math.max(12, rowWidth - option.label.length - 6))}`
                    : "";
                  const rowText = truncateLine(`${option.label}${secondary}`, rowWidth - 4);
                  // One tap toggles and moves the cursor there: a check is
                  // undone by another tap, and nothing runs until confirm.
                  // Taps work while filtering, where Space types instead.
                  return (
                    <MouseTarget
                      key={`${option.label}-${option.detail ?? ""}`}
                      id={`checklist:row:${windowStart + visibleIndex}`}
                      active={!confirmed}
                      onClick={() => {
                        setIndex(windowStart + visibleIndex);
                        toggleOption(option);
                      }}
                      onWheel={(direction) =>
                        setIndex((current) =>
                          Math.max(
                            0,
                            Math.min(
                              filteredOptions.length - 1,
                              current + (direction === "up" ? -1 : 1),
                            ),
                          ),
                        )
                      }
                    >
                      <Text
                        backgroundColor={highlighted && !plain ? palette.accentFill : undefined}
                        color={highlighted ? palette.text : palette.textDim}
                        bold={highlighted || isChecked}
                        dimColor={!highlighted && !isChecked && !plain}
                      >
                        {plain ? selectionPrefix(highlighted, true) : null}
                        <Text
                          color={highlighted ? palette.accent : itemTone}
                        >{`${itemPrefix} `}</Text>
                        {rowText}
                      </Text>
                    </MouseTarget>
                  );
                })}
                {windowEnd < filteredOptions.length && (
                  <Text color={palette.dim}>
                    {plainModeEnabled() ? "More items below" : " ▼ ..."}
                  </Text>
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>
      <ShellFooter
        actions={[
          { key: "ctrl+a", label: "all in view", action: "search" },
          { key: "space", label: "toggle", action: "search" },
          { key: "enter", label: "confirm", action: "search" },
          { key: "esc", label: "back", action: "quit" },
        ]}
        mode="minimal"
        onActivate={(action) => {
          if (confirmed) return;
          const current = filteredOptions[index];
          if (action.key === "enter") confirmSelection();
          else if (action.key === "ctrl+a") toggleAllVisible();
          else if (action.key === "space" && current) toggleOption(current);
          // Esc's order: a typed filter clears first, then the list closes.
          else if (action.key === "esc") {
            if (filterQuery.length > 0) setFilterQuery("");
            else onCancel();
          }
        }}
        taskLabel={
          filterQuery.length > 0
            ? "Clear filter to toggle checks with Space"
            : "Space toggle · Ctrl+A all visible"
        }
      />
    </Box>
  );
}

export function openChecklistShell<T>({
  title,
  subtitle,
  options,
  initialFilter,
  initialSelectedIndex,
}: {
  title: string;
  subtitle: string;
  options: readonly ListOption<T>[];
  initialFilter?: string;
  initialSelectedIndex?: number;
}): Promise<T[] | null> {
  const session = mountRootContent<{ type: "selected"; values: T[] } | { type: "cancelled" }>({
    kind: "picker",
    renderContent: (
      finish: (res: { type: "selected"; values: T[] } | { type: "cancelled" }) => void,
    ) => (
      <ChecklistShell
        title={title}
        subtitle={subtitle}
        options={options}
        initialFilter={initialFilter}
        initialSelectedIndex={initialSelectedIndex}
        onSubmit={(values) => finish({ type: "selected", values })}
        onCancel={() => finish({ type: "cancelled" })}
      />
    ),
    fallbackValue: { type: "cancelled" },
  });

  return session.result.then((result) => (result.type === "selected" ? result.values : null));
}
