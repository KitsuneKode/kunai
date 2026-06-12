import { requestHardExit } from "@/app-shell/graceful-exit";
import {
  getPickerChromeRows,
  getPickerLayout,
  getPickerListMaxVisible,
} from "@/app-shell/layout-policy";
import { useLineEditor } from "@/app-shell/line-editor";
import { mountRootContent } from "@/app-shell/root-content-state";
import { LineEditorText } from "@/app-shell/shell-command-ui";
import { ShellFooter, ResizeBlocker } from "@/app-shell/shell-primitives";
import { getWindowStart, truncateLine } from "@/app-shell/shell-text";
import { palette } from "@/app-shell/shell-theme";
import { useDebouncedViewportPolicy } from "@/app-shell/use-viewport-policy";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useMemo, useState } from "react";

export type ListOption<T> = {
  value: T;
  label: string;
  detail?: string;
};

function ChecklistShell<T>({
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

  useInput((input, key) => {
    if ((input === "c" && key.ctrl) || input === "\x03") {
      requestHardExit(0);
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
      setSelectedSet((current) => {
        if (current.size === filteredOptions.length) {
          return new Set();
        }
        return new Set(filteredOptions.map((o) => o.value));
      });
      return;
    }
    if (input === " " && !filterQuery) {
      const selected = filteredOptions[index];
      if (selected) {
        setSelectedSet((current) => {
          const next = new Set(current);
          if (next.has(selected.value)) {
            next.delete(selected.value);
          } else {
            next.add(selected.value);
          }
          return next;
        });
      }
      return;
    }
    if (key.return) {
      if (!confirmed) {
        setConfirmed(true);
        setTimeout(() => {
          if (selectedSet.size > 0) {
            onSubmit(Array.from(selectedSet));
          } else {
            const currentSelected = filteredOptions[index];
            if (currentSelected) {
              onSubmit([currentSelected.value]);
            } else {
              onSubmit([]);
            }
          }
        }, 150);
      }
      return;
    }
    filterEditor.handleInput(input, key);
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column">
        <Box flexDirection="column">
          <Text color={confirmed ? palette.ok : palette.text} bold>
            {confirmed ? "Selected" : title}
          </Text>
          <Text color={palette.muted}>
            {confirmed ? `${selectedSet.size || 1} items` : subtitle}
          </Text>
        </Box>
        <Box paddingY={1}>
          <Text color={palette.accent}>⌕ </Text>
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
              flexDirection={showSelectionCompanion ? "row" : "column"}
              marginTop={1}
              justifyContent="space-between"
            >
              <Box flexDirection="column" width={showSelectionCompanion ? listWidth : undefined}>
                {windowStart > 0 && <Text color={palette.dim}> ▲ ...</Text>}
                {visibleOptions.map((option) => {
                  const highlighted = option === selectedOption;
                  const isChecked = selectedSet.has(option.value);
                  const isConfirmed = confirmed && isChecked;
                  const itemPrefix = isChecked ? "☑" : "☐";
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
                  return (
                    <Box key={`${option.label}-${option.detail ?? ""}`}>
                      <Text
                        backgroundColor={highlighted ? palette.accentFill : undefined}
                        color={highlighted ? palette.text : "white"}
                        bold={highlighted || isChecked}
                        dimColor={!highlighted && !isChecked}
                      >
                        <Text
                          color={highlighted ? palette.accent : itemTone}
                        >{`${itemPrefix} `}</Text>
                        {rowText}
                      </Text>
                    </Box>
                  );
                })}
                {windowEnd < filteredOptions.length && <Text color={palette.dim}> ▼ ...</Text>}
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
