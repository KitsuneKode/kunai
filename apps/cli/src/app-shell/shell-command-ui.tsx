import { getLineEditorViewport, splitCursor, useLineEditor } from "@/app-shell/line-editor";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

import {
  COMMANDS,
  parseCommand,
  suggestCommands,
  type AppCommandId,
  type ResolvedAppCommand,
} from "./commands";
import { routeShellInput } from "./input-router";
import { getWindowStart, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { toShellAction, type FooterAction, type ShellAction } from "./types";

export function getCommandMatches(
  input: string,
  commands: readonly ResolvedAppCommand[],
): readonly ResolvedAppCommand[] {
  const allowed = commands.map((command) => command.id);
  return suggestCommands(input, allowed)
    .map((command) => commands.find((resolved) => resolved.id === command.id))
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
  return matches[highlightedIndex] ?? matches[0] ?? null;
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
        <Text backgroundColor={palette.cyan} color="black">
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
      <Text backgroundColor={palette.cyan} color="black">
        {visibleCursor}
      </Text>
      <Text color="white">{after}</Text>
    </>
  );
}

export function CommandPalette({
  input,
  cursor = input.length,
  commands,
  highlightedIndex,
  maxVisible = 7,
  width,
}: {
  input: string;
  cursor?: number;
  commands: readonly ResolvedAppCommand[];
  highlightedIndex: number;
  maxVisible?: number;
  width?: number;
}) {
  const matches = getCommandMatches(input, commands);
  const visibleCount = Math.max(3, maxVisible);
  const windowStart = getWindowStart(highlightedIndex, matches.length, visibleCount);
  const windowEnd = Math.min(windowStart + visibleCount, matches.length);
  const visibleMatches = matches.slice(windowStart, windowEnd);
  const contentWidth = Math.max(28, (width ?? 84) - 4);

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
            {visibleMatches.map((command, index) => {
              const absoluteIndex = windowStart + index;
              const selected = absoluteIndex === highlightedIndex;
              return (
                <Box key={command.id} flexDirection="column">
                  <Text
                    backgroundColor={selected ? palette.cyan : undefined}
                    color={selected ? "black" : command.enabled ? palette.muted : palette.gray}
                    bold={selected}
                  >
                    <Text color={selected ? "black" : palette.gray}>{selected ? "❯ " : "  "}</Text>/
                    {truncateLine(`${command.aliases[0]} ${command.description}`, contentWidth - 4)}
                  </Text>
                  {!command.enabled && command.reason ? (
                    <Text color={palette.gray}>
                      {truncateLine(`  ·  ${command.reason}`, contentWidth)}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
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
      const matches = getCommandMatches(commandInput, commands);

      if (key.return) {
        const resolved = getHighlightedCommand(commandInput, commands, highlightedIndex);
        if (resolved?.enabled) {
          onResolve(toShellAction(resolved.id));
          return;
        }
        return;
      }
      if (key.tab) {
        const nextIndex = matches.length > 0 ? (highlightedIndex + 1) % matches.length : 0;
        const target = matches[nextIndex];
        if (target) {
          setHighlightedIndex(nextIndex);
          commandEditor.setValue(target.aliases[0] ?? target.id);
        }
        return;
      }
      if (key.upArrow) {
        if (matches.length > 0) {
          setHighlightedIndex((current) => (current - 1 + matches.length) % matches.length);
        }
        return;
      }
      if (key.downArrow) {
        if (matches.length > 0) {
          setHighlightedIndex((current) => (current + 1) % matches.length);
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
