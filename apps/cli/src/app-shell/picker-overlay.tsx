import { Box, Text, useStdout } from "ink";
import React from "react";

import { getShellViewportPolicy } from "./layout-policy";
import { getFilteredPickerOptions, type PickerState } from "./picker-controller";
import { InputField } from "./shell-frame";
import { ResizeBlocker, ShellFooter } from "./shell-primitives";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { FooterAction } from "./types";

export function PickerOverlay({
  state,
  footerActions = DEFAULT_PICKER_FOOTER_ACTIONS,
}: {
  state: PickerState;
  footerActions?: readonly FooterAction[];
}) {
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 100;
  const rows = stdout.rows ?? 30;
  const policy = getShellViewportPolicy("picker", columns, rows);

  if (policy.tooSmall) {
    return (
      <ResizeBlocker
        columns={columns}
        rows={rows}
        minColumns={policy.minColumns}
        minRows={policy.minRows}
      />
    );
  }

  const filteredOptions = getFilteredPickerOptions(state);
  const visibleRows = Math.min(policy.maxVisibleRows, Math.max(5, filteredOptions.length));
  const windowStart = getWindowStart(state.selectedIndex, filteredOptions.length, visibleRows);
  const visibleOptions = filteredOptions.slice(windowStart, windowStart + visibleRows);
  const selected = filteredOptions[state.selectedIndex] ?? null;
  const contentWidth = Math.max(40, columns - 10);
  const detailWidth = Math.max(24, Math.floor(contentWidth * 0.42));
  const labelWidth = Math.max(24, contentWidth - detailWidth - 8);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.text}>
            {state.title}
          </Text>
          <Text color={palette.dim} dimColor>
            {filteredOptions.length}/{state.options.length}
          </Text>
        </Box>
        <Text color={palette.muted}>{state.subtitle}</Text>

        <Box marginTop={1}>
          <InputField
            label="Filter"
            value={state.filterQuery}
            onChange={() => {}}
            placeholder="type to narrow"
            focus
            maxWidth={contentWidth}
          />
        </Box>

        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            {"─".repeat(contentWidth)}
          </Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {filteredOptions.length === 0 ? (
            <Box flexDirection="column">
              <Text color={palette.dim}>{state.emptyMessage}</Text>
              {state.filterQuery.length > 0 ? (
                <Text color={palette.muted} dimColor>
                  Esc clears the filter
                </Text>
              ) : null}
            </Box>
          ) : (
            <>
              {windowStart > 0 ? <Text color={palette.dim}> more above</Text> : null}
              {visibleOptions.map((option, index) => {
                const absoluteIndex = windowStart + index;
                const isSelected = absoluteIndex === state.selectedIndex;
                const toneColor = option.tone ? statusColor(option.tone) : palette.muted;
                return (
                  <Box key={option.value} justifyContent="space-between">
                    <Text
                      color={isSelected ? "black" : toneColor}
                      backgroundColor={isSelected ? palette.accentFill : undefined}
                      bold={isSelected}
                    >
                      {isSelected ? "❯ " : "  "}
                      {truncateLine(option.label, labelWidth)}
                    </Text>
                    <Text color={option.tone ? toneColor : palette.dim}>
                      {truncateLine(option.badge ?? option.detail ?? "", detailWidth)}
                    </Text>
                  </Box>
                );
              })}
              {windowStart + visibleRows < filteredOptions.length ? (
                <Text color={palette.dim}> more below</Text>
              ) : null}
            </>
          )}
        </Box>

        {selected?.detail ? (
          <Box marginTop={1} paddingX={1}>
            <Text color={palette.dim} dimColor>
              {truncateLine(selected.detail, contentWidth - 4)}
            </Text>
          </Box>
        ) : null}
      </Box>

      <ShellFooter taskLabel={state.title} actions={footerActions} mode="minimal" />
    </Box>
  );
}

const DEFAULT_PICKER_FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "enter", label: "select", action: "details" },
  { key: "esc", label: "close", action: "quit" },
  { key: "/", label: "filter", action: "command-mode" },
];
