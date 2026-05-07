import { Box, Text, useStdout } from "ink";
import React from "react";

import { getShellViewportPolicy } from "./layout-policy";
import { getFilteredPickerOptions, type PickerState } from "./picker-controller";
import { LineEditorText } from "./shell-command-ui";
import { ResizeBlocker, ShellFooter } from "./shell-primitives";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { FooterAction } from "./types";

export function PickerOverlay({
  state,
  cursor = state.filterQuery.length,
  footerActions = DEFAULT_PICKER_FOOTER_ACTIONS,
}: {
  state: PickerState;
  cursor?: number;
  footerActions?: readonly FooterAction[];
}) {
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 100;
  const rows = stdout.rows ?? 30;
  const policy = getShellViewportPolicy("picker", columns, rows);

  if (policy.tooSmall) {
    return <ResizeBlocker minColumns={policy.minColumns} minRows={policy.minRows} />;
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
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={palette.amber}
        paddingX={1}
        paddingY={0}
      >
        <Box justifyContent="space-between">
          <Text bold color={palette.text}>
            {state.title}
          </Text>
          <Text color={palette.gray}>
            {filteredOptions.length}/{state.options.length}
          </Text>
        </Box>
        <Text color={palette.muted}>{state.subtitle}</Text>

        <Box marginTop={1}>
          <Text color={palette.cyan}>/ </Text>
          <LineEditorText value={state.filterQuery} cursor={cursor} focused placeholder="filter" />
        </Box>

        <Box marginTop={1} flexDirection="column">
          {filteredOptions.length === 0 ? (
            <Text color={palette.gray}>{state.emptyMessage}</Text>
          ) : (
            <>
              {windowStart > 0 ? <Text color={palette.gray}> more above</Text> : null}
              {visibleOptions.map((option, index) => {
                const absoluteIndex = windowStart + index;
                const isSelected = absoluteIndex === state.selectedIndex;
                const toneColor = option.tone ? statusColor(option.tone) : palette.muted;
                return (
                  <Box key={option.value} justifyContent="space-between">
                    <Text
                      color={isSelected ? "black" : toneColor}
                      backgroundColor={isSelected ? palette.cyan : undefined}
                      bold={isSelected}
                    >
                      {isSelected ? "> " : "  "}
                      {truncateLine(option.label, labelWidth)}
                    </Text>
                    <Text color={option.tone ? toneColor : palette.gray}>
                      {truncateLine(option.badge ?? option.detail ?? "", detailWidth)}
                    </Text>
                  </Box>
                );
              })}
              {windowStart + visibleRows < filteredOptions.length ? (
                <Text color={palette.gray}> more below</Text>
              ) : null}
            </>
          )}
        </Box>

        {selected?.detail ? (
          <Box
            marginTop={1}
            borderStyle="single"
            borderColor={palette.surfaceElevated}
            paddingX={1}
          >
            <Text color={palette.gray}>{truncateLine(selected.detail, contentWidth - 6)}</Text>
          </Box>
        ) : null}
      </Box>

      <ShellFooter taskLabel="Picker" actions={footerActions} mode="minimal" />
    </Box>
  );
}

const DEFAULT_PICKER_FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "enter", label: "select", action: "details" },
  { key: "esc", label: "close", action: "quit" },
  { key: "/", label: "filter", action: "command-mode" },
];
