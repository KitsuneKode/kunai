import { getLineEditorViewport, splitCursor, useLineEditor } from "@/app-shell/line-editor";
import { buildPickerModel, movePickerModelSelection } from "@/domain/session/picker-model";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

import { COMMANDS, parseCommand, type AppCommandId, type ResolvedAppCommand } from "./commands";
import { routeShellInput } from "./input-router";
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
  const exact = parseCommand(input);
  if (exact) {
    return commands.find((candidate) => candidate.id === exact.id) ?? null;
  }

  const matches = getCommandMatches(input, commands);
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  return (
    commands.find((command) => command.id === model.selectedOption?.value) ?? matches[0] ?? null
  );
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
      <Text color="white">{displayValue}</Text>
    ) : (
      <Text color={palette.gray}>{visiblePlaceholder ?? ""}</Text>
    );
  }

  if (value.length === 0) {
    return (
      <>
        <Text backgroundColor={palette.teal} color="black">
          {" "}
        </Text>
        {visiblePlaceholder ? <Text color={palette.gray}>{visiblePlaceholder}</Text> : null}
      </>
    );
  }

  const { before, cursorChar, after } = splitCursor(viewport.value, viewport.cursor);
  const visibleCursor = cursorChar.length > 0 ? cursorChar : " ";

  return (
    <>
      <Text color="white">{before}</Text>
      <Text backgroundColor={palette.teal} color="black">
        {visibleCursor}
      </Text>
      <Text color="white">{after}</Text>
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
      keywords: command.aliases,
    })),
  });
}

export function CommandPalette({
  input,
  cursor = input.length,
  commands,
  highlightedIndex,
  maxVisible = 5,
  width,
}: {
  input: string;
  cursor?: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  maxVisible?: number;
  width?: number;
}) {
  const model = buildCommandPickerModel(input, commands, highlightedIndex);
  const matches = model.options
    .map((option) => commands.find((command) => command.id === option.value))
    .filter((command): command is ResolvedAppCommand => Boolean(command));
  const visibleCount = Math.max(3, maxVisible);
  const windowStart = getWindowStart(model.selectedIndex, matches.length, visibleCount);
  const windowEnd = Math.min(windowStart + visibleCount, matches.length);
  const visibleMatches = matches.slice(windowStart, windowEnd);
  const contentWidth = Math.max(28, (width ?? 84) - 4);

  const showGrouped = input.trim().length === 0 && matches.length > 0;

  const renderCommand = (command: ResolvedAppCommand, absoluteIndex: number) => {
    const selected = absoluteIndex === model.selectedIndex;
    return (
      <Box key={command.id} flexDirection="column">
        <Text
          backgroundColor={selected ? palette.teal : undefined}
          color={selected ? "black" : command.enabled ? palette.muted : palette.gray}
          bold={selected}
        >
          <Text color={selected ? "black" : palette.gray}>{selected ? "❯ " : "  "}</Text>/
          {truncateLine(`${command.aliases[0]} ${command.description}`, contentWidth - 4)}
        </Text>
        {!command.enabled && command.reason ? (
          <Text color={palette.gray}>{truncateLine(`  ·  ${command.reason}`, contentWidth)}</Text>
        ) : null}
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.amber}
      paddingX={1}
      paddingY={0}
      marginTop={1}
      width={width}
    >
      <Text color={palette.amber}>Command</Text>
      <Box>
        <Text color="white">/</Text>
        <LineEditorText value={input} cursor={cursor} focused placeholder="type a command" />
      </Box>
      <Text color={palette.gray}>
        Tab autocomplete · ↑↓ choose · Enter run
        {matches.length > visibleMatches.length ? ` · ${matches.length} commands` : ""}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {matches.length > 0 ? (
          <>
            {windowStart > 0 ? <Text color={palette.gray}> ▲ more</Text> : null}
            {showGrouped ? (
              <>
                {(() => {
                  const rows: React.ReactNode[] = [];
                  let previousGroup: "context" | "global" | null = null;
                  for (const [index, command] of visibleMatches.entries()) {
                    const group = CONTEXT_COMMAND_IDS.has(command.id) ? "context" : "global";
                    if (group !== previousGroup) {
                      rows.push(
                        <Text
                          key={`group:${group}:${windowStart + index}`}
                          color={palette.gray}
                          dimColor
                        >
                          {COMMAND_GROUP_LABELS[group]}
                        </Text>,
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
            {windowEnd < matches.length ? <Text color={palette.gray}> ▼ more</Text> : null}
          </>
        ) : (
          <Text color={palette.gray}>No matching commands</Text>
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
        const nextIndex = movePickerModelSelection(model, 1);
        const target = commands.find((command) => command.id === model.options[nextIndex]?.value);
        if (target) {
          setHighlightedIndex(nextIndex);
          commandEditor.setValue(target.aliases[0] ?? target.id);
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
