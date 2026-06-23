import { getLineEditorViewport, splitCursor } from "@/app-shell/line-editor";
import { Box, Text } from "ink";
import React from "react";

import type { ResolvedAppCommand } from "./commands";
import { getCommandPaletteVisibleCommandCount } from "./layout-policy";
import {
  COMMAND_GROUP_LABELS,
  CONTEXT_COMMAND_IDS,
  buildCommandPickerModel,
  getPlaybackCommandPaletteMaxVisible,
  resolveCommandPaletteWidth,
} from "./shell-command-model";
import { getWindowStart, padColumnsEnd, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { useShellDimensions } from "./use-viewport-policy";

export function LineEditorText({
  value,
  cursor,
  focused,
  placeholder,
  maxWidth,
}: {
  value: string;
  cursor: number;
  focused: boolean;
  placeholder?: string;
  maxWidth?: number;
}) {
  const viewport = getLineEditorViewport(value, cursor, maxWidth);
  const visiblePlaceholder =
    placeholder && maxWidth ? truncateLine(placeholder, Math.max(1, maxWidth - 1)) : placeholder;

  if (!focused) {
    const displayValue =
      value.length > 0 && maxWidth ? truncateLine(value, Math.max(1, maxWidth)) : value;
    return displayValue.length > 0 ? (
      <Text color={palette.text}>{displayValue}</Text>
    ) : (
      <Text color={palette.dim}>{visiblePlaceholder ?? ""}</Text>
    );
  }

  if (value.length === 0) {
    return (
      <>
        <Text backgroundColor={palette.accent} color="black">
          {" "}
        </Text>
        {visiblePlaceholder ? <Text color={palette.dim}>{visiblePlaceholder}</Text> : null}
      </>
    );
  }

  const { before, cursorChar, after } = splitCursor(viewport.value, viewport.cursor);
  const visibleCursor = cursorChar.length > 0 ? cursorChar : " ";

  return (
    <>
      <Text color={palette.text}>{before}</Text>
      <Text backgroundColor={palette.accent} color="black">
        {visibleCursor}
      </Text>
      <Text color={palette.text}>{after}</Text>
    </>
  );
}

export function CommandPalette({
  input,
  cursor = input.length,
  commands,
  highlightedIndex,
  maxVisible: maxVisibleProp,
  width,
}: {
  input: string;
  cursor?: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  maxVisible?: number;
  width?: number;
}) {
  const { cols: shellColumns, rows: terminalRows } = useShellDimensions();
  const shellWidth = Math.max(28, width ?? shellColumns);
  const maxVisible = maxVisibleProp ?? getPlaybackCommandPaletteMaxVisible(terminalRows);
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  const matches = model.options
    .map((option) => commands.find((command) => command.id === option.value))
    .filter((command): command is ResolvedAppCommand => Boolean(command));
  const showGrouped = input.trim().length === 0 && matches.length > 0;
  const visibleCount = getCommandPaletteVisibleCommandCount({
    maxRows: Math.max(1, maxVisible),
    totalMatches: matches.length,
    grouped: showGrouped,
  });
  const windowStart = getWindowStart(model.selectedIndex, matches.length, visibleCount);
  const windowEnd = Math.min(windowStart + visibleCount, matches.length);
  const visibleMatches = matches.slice(windowStart, windowEnd);
  const contentWidth = resolveCommandPaletteWidth(Math.min(shellWidth, shellColumns));

  const renderCommand = (command: ResolvedAppCommand, absoluteIndex: number) => {
    const selected = absoluteIndex === model.selectedIndex;
    const alias = `/${command.aliases[0]}`;
    const aliasWidth = Math.min(20, Math.max(10, Math.floor(contentWidth * 0.28)));
    const detailWidth = Math.max(10, contentWidth - aliasWidth - 7);
    const detail = padColumnsEnd(truncateLine(command.description, detailWidth), detailWidth);
    const showReason = !command.enabled && (selected || command.reason);
    return (
      <Box key={command.id} flexDirection="column" width={contentWidth + 4}>
        <Box
          width={contentWidth + 4}
          backgroundColor={selected ? palette.surfaceActive : undefined}
        >
          <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
          <Text
            color={!command.enabled ? palette.dim : selected ? palette.accent : palette.text}
            bold={selected && command.enabled}
            dimColor={!command.enabled}
          >
            {padColumnsEnd(truncateLine(alias, aliasWidth), aliasWidth)}
          </Text>
          <Text color={palette.dim}> </Text>
          <Text
            wrap="truncate"
            color={command.enabled ? (selected ? "white" : palette.muted) : palette.dim}
            dimColor={!command.enabled}
          >
            {detail}
          </Text>
        </Box>
        {showReason ? (
          <Box paddingLeft={4}>
            <Text color={palette.dim} dimColor>
              {command.reason ?? "unavailable"}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginTop={1} width={shellWidth} flexShrink={0}>
      <Box marginTop={0}>
        <Text color={palette.accent}>/</Text>
        <LineEditorText
          value={input}
          cursor={cursor}
          focused
          placeholder="type a command"
          maxWidth={Math.max(8, contentWidth - 2)}
        />
      </Box>
      <Text color={palette.dim} dimColor>
        Tab autocomplete · ↑↓ choose · Enter run
        {matches.length > visibleMatches.length ? ` · ${matches.length} commands` : ""}
      </Text>
      <Box flexDirection="column">
        {matches.length > 0 ? (
          <>
            {/* Scroll affordance only when there is actually more above — no empty
                placeholder line, so the palette stays tight. */}
            {windowStart > 0 ? <Text color={palette.dim}> ▲ more</Text> : null}
            {showGrouped ? (
              <>
                {(() => {
                  const rows: React.ReactNode[] = [];
                  let previousGroup: "context" | "global" | null = null;
                  for (const [index, command] of visibleMatches.entries()) {
                    const group = CONTEXT_COMMAND_IDS.has(command.id) ? "context" : "global";
                    if (group !== previousGroup) {
                      rows.push(
                        <Box
                          key={`group:${group}:${windowStart + index}`}
                          marginTop={index > 0 ? 1 : 0}
                        >
                          <Text color={palette.dim} dimColor>
                            {COMMAND_GROUP_LABELS[group].toUpperCase()}
                          </Text>
                        </Box>,
                      );
                      previousGroup = group;
                    }
                    rows.push(renderCommand(command, windowStart + index));
                  }
                  return <>{rows}</>;
                })()}
              </>
            ) : (
              visibleMatches.map((command, index) => {
                const absoluteIndex = windowStart + index;
                return renderCommand(command, absoluteIndex);
              })
            )}
            {windowEnd < matches.length ? <Text color={palette.dim}> ▼ more</Text> : null}
          </>
        ) : (
          <Text color={palette.dim}>No matching commands</Text>
        )}
      </Box>
    </Box>
  );
}
