import { Box, Text, useStdout } from "ink";
import React from "react";

import { getShellViewportPolicy } from "./layout-policy";
import { getFilteredPickerOptions, type PickerState } from "./picker-controller";
import { StateBlock } from "./primitives/StateBlock";
import type { StateBlockModel } from "./primitives/StateBlock.model";
import { InputField } from "./shell-frame";
import { ResizeBlocker, ShellFooter } from "./shell-primitives";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { FooterAction } from "./types";

export type PickerInspectionMode =
  | { readonly kind: "fact"; readonly title: string; readonly detail?: string }
  | { readonly kind: "unavailable"; readonly model: StateBlockModel }
  | { readonly kind: "picker" };

export function resolvePickerInspectionMode(state: PickerState): PickerInspectionMode {
  const options = getFilteredPickerOptions(state);
  if (options.length === 0) {
    return {
      kind: "unavailable",
      model: buildUnavailablePickerState(state),
    };
  }

  if (state.options.length === 1) {
    const only = state.options[0];
    return {
      kind: "fact",
      title: only?.label ?? "Only option",
      detail: only?.detail ?? only?.badge,
    };
  }

  return { kind: "picker" };
}

export function PickerOverlay({
  state,
  footerActions,
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
  const inspectionMode = resolvePickerInspectionMode(state);
  const resolvedFooterActions = footerActions ?? getDefaultPickerFooterActions(inspectionMode);
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
          {inspectionMode.kind === "unavailable" ? (
            <StateBlock model={inspectionMode.model} width={contentWidth} />
          ) : inspectionMode.kind === "fact" ? (
            <Box flexDirection="column">
              <Text color={palette.ok} bold>
                ✓ {truncateLine(inspectionMode.title, contentWidth - 2)}
              </Text>
              {inspectionMode.detail ? (
                <Text color={palette.muted}>
                  {truncateLine(inspectionMode.detail, contentWidth - 2)}
                </Text>
              ) : null}
              <Text color={palette.dim} dimColor>
                This capability has one provider-exposed value, so there is nothing to choose.
              </Text>
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

      <ShellFooter taskLabel={state.title} actions={resolvedFooterActions} mode="minimal" />
    </Box>
  );
}

function buildUnavailablePickerState(state: PickerState): StateBlockModel {
  const filtered = state.filterQuery.trim().length > 0;
  const title = filtered ? "No matching capability" : `${capabilityName(state.id)} unavailable`;
  const detail = filtered
    ? `${state.emptyMessage}. Esc clears the filter and restores the full capability list.`
    : `${state.emptyMessage}. ${recoveryHint(state.id)}`;

  return {
    kind: filtered ? "empty" : "error",
    title,
    detail,
    actions: [
      filtered
        ? {
            id: "clear-filter",
            label: "Clear filter",
            detail: "Press Esc once to return to all rows.",
            shortcut: "esc",
            tone: "muted",
          }
        : {
            id: "recover",
            label: "Recover",
            detail: recoveryHint(state.id),
            shortcut: "/",
            tone: "danger",
          },
    ],
  };
}

function capabilityName(id: string): string {
  if (id.includes("source")) return "Source";
  if (id.includes("quality")) return "Quality";
  if (id.includes("subtitle")) return "Subtitles";
  if (id.includes("audio")) return "Audio";
  if (id.includes("hardsub")) return "Hardsub";
  return "Capability";
}

function recoveryHint(id: string): string {
  if (id.includes("source") || id.includes("quality")) {
    return "Use commands for diagnostics or recover playback, then try provider fallback if needed.";
  }
  if (id.includes("subtitle") || id.includes("audio") || id.includes("hardsub")) {
    return "Use commands for diagnostics, or continue with the current stream defaults.";
  }
  return "Use commands for diagnostics, then retry the current task.";
}

function getDefaultPickerFooterActions(mode: PickerInspectionMode): readonly FooterAction[] {
  if (mode.kind === "picker") return DEFAULT_PICKER_FOOTER_ACTIONS;
  return [
    { key: "esc", label: "close", action: "quit" },
    { key: "/", label: "commands", action: "command-mode" },
  ];
}

const DEFAULT_PICKER_FOOTER_ACTIONS: readonly FooterAction[] = [
  { key: "enter", label: "select", action: "details" },
  { key: "esc", label: "close", action: "quit" },
  { key: "/", label: "commands", action: "command-mode" },
];
