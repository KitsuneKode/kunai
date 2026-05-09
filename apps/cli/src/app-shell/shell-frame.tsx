import { useLineEditor } from "@/app-shell/line-editor";
import { Box, Text, useInput, useStdout } from "ink";
import React from "react";

import type { AppCommandId, ResolvedAppCommand } from "./commands";
import { requestHardExit } from "./graceful-exit";
import { isHardGlobalQuit, routeShellInput } from "./input-router";
import { CommandPalette, LineEditorText, useShellInput } from "./shell-command-ui";
import { ShellFooter } from "./shell-primitives";
import { truncateLine } from "./shell-text";
import { palette, statusColor } from "./shell-theme";
import type { FooterAction, ShellAction, ShellFooterMode, ShellStatus } from "./types";

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
  escapeAction,
  onResolve,
  children,
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
  escapeAction?: ShellAction | null;
  onResolve: (action: ShellAction) => void;
  children: React.ReactNode;
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
    escapeAction,
    onResolve,
  });

  const { stdout } = useStdout();
  const commandWidth = Math.min(92, Math.max(36, Math.floor((stdout.columns ?? 80) * 0.62)));

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      justifyContent="space-between"
      backgroundColor={palette.bg}
      paddingX={1}
    >
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={palette.text}>
            {title}
          </Text>
          {status ? <Text color={statusColor(status.tone)}>{status.label}</Text> : null}
        </Box>
        <Text color={palette.muted}>{subtitle}</Text>
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
            maxVisible={5}
            width={commandWidth}
          />
        ) : null}

        <ShellFooter
          taskLabel={footerTask}
          actions={footerActions}
          mode={footerMode}
          commandMode={commandMode && !inputLocked}
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
}) {
  const { stdout } = useStdout();
  const wideField = (stdout.columns ?? 0) >= 112;
  const fieldWidth = Math.max(20, maxWidth ?? (stdout.columns ?? 80) - 8);
  const textWidth = Math.max(4, fieldWidth - 8);
  const hintWidth = Math.max(12, fieldWidth - (wideField ? 18 : 2));
  const renderedHint = hint ? truncateLine(hint, hintWidth) : undefined;
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
      <Box justifyContent="space-between">
        <Text color={palette.muted}>{label}</Text>
        {renderedHint && wideField ? (
          <Text color={palette.gray} dimColor>
            {renderedHint}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box paddingX={1}>
          <Text color={focus ? palette.teal : palette.gray}>{focus ? "⌕ " : "› "}</Text>
          <LineEditorText
            value={value}
            cursor={editor.cursor}
            focused={focus}
            placeholder={placeholder}
            maxWidth={textWidth}
          />
        </Box>
        <Box>
          <Text color={focus ? palette.teal : palette.gray} dimColor>
            {"─".repeat(Math.max(4, fieldWidth))}
          </Text>
        </Box>
      </Box>
      {renderedHint && !wideField ? (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {renderedHint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function footerActionFromCommand(
  commands: readonly ResolvedAppCommand[],
  id: AppCommandId,
  presentation: { key: string; label: string },
  toShellAction: (commandId: AppCommandId) => ShellAction,
): FooterAction {
  const command = commands.find((candidate) => candidate.id === id);
  return {
    key: presentation.key,
    label: presentation.label,
    action: toShellAction(id),
    disabled: command ? !command.enabled : false,
    reason: command?.reason,
  };
}

export function getCommandLabel(
  commands: readonly ResolvedAppCommand[],
  id: AppCommandId,
  fallback: string,
): string {
  return commands.find((command) => command.id === id)?.label.toLowerCase() ?? fallback;
}
