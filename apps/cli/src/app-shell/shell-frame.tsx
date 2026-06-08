import { useLineEditor } from "@/app-shell/line-editor";
import { Box, Text, useInput } from "ink";
import React from "react";

import type { AppCommandId, ResolvedAppCommand } from "./commands";
import { requestHardExit } from "./graceful-exit";
import { isHardGlobalQuit, routeShellInput } from "./input-router";
import { useShellInput } from "./shell-command-input";
import {
  getPlaybackCommandPaletteMaxVisible,
  resolveCommandPaletteWidth,
} from "./shell-command-model";
import { CommandPalette, LineEditorText } from "./shell-command-ui";
import { ShellFooter } from "./shell-primitives";
import { measureColumns, truncateLine } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { FooterAction, ShellAction, ShellFooterMode, ShellStatus } from "./types";
import { useShellDimensions } from "./use-viewport-policy";

type ShellFrameInputKey = Parameters<Parameters<typeof useInput>[0]>[1];

export function ShellFrame({
  eyebrow: _eyebrow,
  title,
  subtitle,
  status,
  footerTask,
  footerActions,
  footerMode,
  commands,
  inputLocked = false,
  letterKeysHandledExternally = false,
  escapeAction,
  onUnhandledInput,
  onResolve,
  children,
  terminalWidth: terminalWidthProp,
  terminalRows: terminalRowsProp,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  status?: ShellStatus;
  footerTask: string;
  footerActions: readonly FooterAction[];
  footerMode?: ShellFooterMode;
  commands: readonly ResolvedAppCommand[];
  inputLocked?: boolean;
  letterKeysHandledExternally?: boolean;
  escapeAction?: ShellAction | null;
  onUnhandledInput?: (input: string, key: ShellFrameInputKey) => void;
  onResolve: (action: ShellAction) => void;
  children: React.ReactNode;
  terminalWidth?: number;
  terminalRows?: number;
}) {
  useInput((input, key) => {
    if (isHardGlobalQuit(input, key)) {
      requestHardExit(0);
    }
  });

  const { commandMode, commandInput, commandCursor, highlightedIndex } = useShellInput({
    footerActions,
    commands,
    disabled: inputLocked,
    letterKeysHandledExternally,
    escapeAction,
    onResolve,
  });

  useInput((input, key) => {
    if (inputLocked || commandMode) return;
    if (input === "?") {
      onResolve("help");
      return;
    }
    onUnhandledInput?.(input, key);
  });

  const { cols: shellCols, rows: shellRows } = useShellDimensions();
  const cols = terminalWidthProp ?? shellCols;
  const rows = terminalRowsProp ?? shellRows;
  const commandWidth = resolveCommandPaletteWidth(cols);
  const statusLabel = status?.label;
  const statusWidth = statusLabel ? measureColumns(statusLabel) : 0;
  const titleWidth = Math.max(12, cols - statusWidth - (statusLabel ? 3 : 0));
  const subtitleWidth = Math.max(12, cols - 2);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      justifyContent="space-between"
      backgroundColor={palette.bg}
    >
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.text}>
            {truncateLine(title, titleWidth)}
          </Text>
          {statusLabel ? <Text color={statusColor(status.tone)}>{statusLabel}</Text> : null}
        </Box>
        <Text color={palette.muted}>{truncateLine(subtitle, subtitleWidth)}</Text>
        <Box marginTop={1} flexDirection="column" flexGrow={1}>
          {children}
        </Box>
      </Box>

      <Box flexDirection="column">
        {commandMode ? (
          <CommandPalette
            input={commandInput}
            cursor={commandCursor}
            commands={commands}
            highlightedIndex={highlightedIndex}
            maxVisible={getPlaybackCommandPaletteMaxVisible(rows)}
            width={commandWidth}
          />
        ) : null}

        <ShellFooter
          taskLabel={footerTask}
          actions={footerActions}
          mode={footerMode}
          commandMode={commandMode && !inputLocked}
          terminalWidth={cols}
        />
      </Box>
    </Box>
  );
}

export function InputField({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  focus = true,
  hint,
  maxWidth,
  onRedraw,
  terminalWidth: terminalWidthProp,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  hint?: string;
  maxWidth?: number;
  onRedraw?: () => void;
  terminalWidth?: number;
}) {
  const { cols } = useShellDimensions();
  const fieldWidth = Math.max(20, maxWidth ?? (terminalWidthProp ?? cols) - 8);
  const textWidth = Math.max(4, fieldWidth - 8);
  const renderedHint = hint ? truncateLine(hint, Math.max(12, fieldWidth - 4)) : undefined;
  const editor = useLineEditor({
    value,
    onChange,
    onSubmit,
    onRedraw,
  });

  useInput((input, key) => {
    if (!focus) return;
    const route = routeShellInput(input, key, { textInputFocused: focus });
    if (route.owner === "hard-global") {
      requestHardExit(0);
    }
    if (
      route.command === "open-command-palette" ||
      key.escape ||
      key.upArrow ||
      key.downArrow ||
      key.tab
    ) {
      return;
    }
    editor.handleInput(input, key);
  });

  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color={palette.muted}>{label}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box paddingX={1}>
          <Text color={focus ? palette.accent : palette.dim}>{focus ? "⌕ " : "› "}</Text>
          <LineEditorText
            value={value}
            cursor={editor.cursor}
            focused={focus}
            placeholder={placeholder}
            maxWidth={textWidth}
          />
        </Box>
        <Box>
          <Text color={focus ? palette.accent : palette.dim} dimColor>
            {"─".repeat(Math.max(4, fieldWidth))}
          </Text>
        </Box>
      </Box>
      {renderedHint ? (
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            {renderedHint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function getCommandLabel(
  commands: readonly ResolvedAppCommand[],
  id: AppCommandId,
  fallback: string,
): string {
  return commands.find((command) => command.id === id)?.label.toLowerCase() ?? fallback;
}
