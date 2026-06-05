import { getLineEditorViewport, splitCursor, useLineEditor } from "@/app-shell/line-editor";
import { buildPickerModel, movePickerModelSelection } from "@/domain/session/picker-model";
import { Box, Text, useInput, useStdout } from "ink";
import React, { useEffect, useState } from "react";

import { COMMANDS, type AppCommandId, type ResolvedAppCommand } from "./commands";
import { routeShellInput } from "./input-router";
import { getCommandPaletteVisibleCommandCount } from "./layout-policy";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { toShellAction, type FooterAction, type ShellAction } from "./types";

export function getCommandMatches(
  input: string,
  commands: readonly ResolvedAppCommand[],
): readonly ResolvedAppCommand[] {
  return buildCommandPickerModel(input, commands, 0)
    .options.map((option) => commands.find((command) => command.id === option.value))
    .filter((command): command is ResolvedAppCommand => Boolean(command));
}

export function getHighlightedCommand(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
): ResolvedAppCommand | null {
  // INVARIANT: Enter runs exactly the row the palette highlights. Resolve from the
  // SAME picker model the palette renders — never via a separate exact-parse
  // shortcut, which can diverge from the visible highlight (e.g. an exact alias
  // like "c" overriding a row you navigated to).
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  return commands.find((command) => command.id === model.selectedOption?.value) ?? null;
}

export function getCommandAutocompleteTarget(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
): ResolvedAppCommand | null {
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  if (model.options.length === 0) return null;

  const normalized = input.trim().replace(/^\//, "").toLowerCase();
  const selected = commands.find((command) => command.id === model.selectedOption?.value) ?? null;
  if (!normalized || !selected) return selected;

  const selectedAlias = selected.aliases[0] ?? selected.id;
  if (selectedAlias.toLowerCase() !== normalized) return selected;

  const nextIndex = movePickerModelSelection(model, 1);
  return commands.find((command) => command.id === model.options[nextIndex]?.value) ?? selected;
}

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

/** Commands that appear under the "Context" group header in the palette. */
const CONTEXT_COMMAND_IDS = new Set<AppCommandId>([
  "toggle-autoplay",
  "replay",
  "recover",
  "fallback",
  "streams",
  "source",
  "quality",
  "memory",
  "pick-episode",
  "next",
  "previous",
  "next-season",
  "download",
]);

const COMMAND_GROUP_LABELS = {
  context: "Context",
  global: "Global",
} as const;

export function shouldHideCompanionForCommandPalette(commandMode: boolean): boolean {
  return commandMode;
}

export function getPlaybackCommandPaletteMaxVisible(rows: number): number {
  const playbackChromeRows = 14;
  const availableRows = rows - 4 - playbackChromeRows - 4 - 5 - 3;
  return Math.max(1, Math.min(18, availableRows));
}

export function getListShellCommandPaletteMaxVisible(
  rows: number,
  subtitleLineCount: number,
): number {
  const subtitleRows = Math.min(subtitleLineCount, 6);
  const listChromeRows = 1 + subtitleRows + 7 + 1 + 1 + 4;
  const availableRows = rows - 4 - listChromeRows - 4 - 5 - 3;
  return Math.max(1, Math.min(18, availableRows));
}

export function resolveCommandPaletteWidth(shellWidth: number): number {
  const columns = Math.max(28, shellWidth);
  return Math.max(28, Math.min(columns, columns - 4) - 4);
}

export function buildCommandPickerModel(
  input: string,
  commands: readonly ResolvedAppCommand[],
  highlightedIndex: number,
) {
  const showGrouped = input.trim().length === 0;
  return buildPickerModel<AppCommandId>({
    query: input,
    selectedIndex: highlightedIndex,
    groupOrder: showGrouped ? ["context", "global"] : undefined,
    groupLabels: COMMAND_GROUP_LABELS,
    options: commands.map((command) => ({
      id: command.id,
      value: command.id,
      label: command.label,
      detail: command.description,
      enabled: command.enabled,
      disabledReason: command.reason,
      group: showGrouped ? (CONTEXT_COMMAND_IDS.has(command.id) ? "context" : "global") : undefined,
      keywords: command.aliases.map((alias, index) => ({
        value: alias,
        weight: index === 0 ? -8 : 6,
      })),
    })),
  });
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
  const { stdout } = useStdout();
  const terminalRows = stdout.rows ?? 24;
  const shellColumns = stdout.columns ?? 80;
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
    const detail = truncateLine(command.description, detailWidth).padEnd(detailWidth);
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
            {truncateLine(alias, aliasWidth).padEnd(aliasWidth)}
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
      <Box flexDirection="column" marginTop={1}>
        {matches.length > 0 ? (
          <>
            {/* Reserve the scroll-affordance line so paging never shifts the whole
                list vertically (the palette renders on every surface). */}
            <Text color={palette.dim}>{windowStart > 0 ? " ▲ more" : " "}</Text>
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
            <Text color={palette.dim}>{windowEnd < matches.length ? " ▼ more" : " "}</Text>
          </>
        ) : (
          <Text color={palette.dim}>No matching commands</Text>
        )}
      </Box>
    </Box>
  );
}

export function useShellInput({
  footerActions,
  commands,
  disabled = false,
  escapeAction = "quit",
  onResolve,
}: {
  footerActions: readonly FooterAction[];
  commands: readonly ResolvedAppCommand[];
  disabled?: boolean;
  escapeAction?: ShellAction | null;
  onResolve: (action: ShellAction) => void;
}) {
  const [commandMode, setCommandMode] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const commandEditor = useLineEditor({
    value: commandInput,
    onChange: (nextValue) => {
      setCommandInput(nextValue);
      setHighlightedIndex(0);
    },
  });

  useEffect(() => {
    if (disabled) {
      setCommandMode(false);
      setCommandInput("");
      setHighlightedIndex(0);
      return;
    }
    if (!commandMode) {
      setHighlightedIndex(0);
      return;
    }

    const matches = getCommandMatches(commandInput, commands);
    setHighlightedIndex((current) => {
      if (matches.length === 0) return 0;
      return Math.min(current, matches.length - 1);
    });
  }, [commandInput, commandMode, commands, disabled]);

  useInput((input, key) => {
    if (disabled) {
      return;
    }

    const route = routeShellInput(input, key, { commandPaletteOpen: commandMode });
    if (route.owner === "hard-global") return;

    if (key.escape) {
      if (commandMode) {
        setCommandMode(false);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      if (escapeAction) onResolve(escapeAction);
      return;
    }

    if (commandMode) {
      const model = buildCommandPickerModel(commandInput, commands, highlightedIndex);

      if (key.return) {
        const resolved = getHighlightedCommand(commandInput, commands, highlightedIndex);
        if (resolved?.enabled) {
          onResolve(toShellAction(resolved.id));
          return;
        }
        return;
      }
      if (key.tab) {
        const target = getCommandAutocompleteTarget(commandInput, commands, highlightedIndex);
        if (target) {
          commandEditor.setValue(target.aliases[0] ?? target.id);
          const targetIndex = model.options.findIndex((option) => option.value === target.id);
          setHighlightedIndex(Math.max(0, targetIndex));
        }
        return;
      }
      if (key.upArrow) {
        if (model.options.length > 0) {
          setHighlightedIndex(movePickerModelSelection(model, -1));
        }
        return;
      }
      if (key.downArrow) {
        if (model.options.length > 0) {
          setHighlightedIndex(movePickerModelSelection(model, 1));
        }
        return;
      }
      if (commandEditor.handleInput(input, key)) {
        return;
      }
      return;
    }

    if (route.command === "open-command-palette" && commands.length > 0) {
      setCommandMode(true);
      setCommandInput("");
      return;
    }

    const footerAction = footerActions.find(
      (action) => action.key === input.toLowerCase() && !action.disabled,
    );
    if (footerAction) {
      if (footerAction.action === "command-mode") {
        setCommandMode(true);
        setCommandInput("");
        setHighlightedIndex(0);
        return;
      }
      onResolve(footerAction.action);
    }
  });

  return { commandMode, commandInput, commandCursor: commandEditor.cursor, highlightedIndex };
}

export function fallbackCommandState(
  allowed: readonly AppCommandId[],
): readonly ResolvedAppCommand[] {
  return allowed
    .map((id) => COMMANDS.find((command) => command.id === id))
    .filter((command): command is ResolvedAppCommand => Boolean(command))
    .map((command) => ({
      ...command,
      enabled: true,
    }));
}
