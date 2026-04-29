import React from "react";
import { Box, Text, useInput, useStdout } from "ink";

import { useLineEditor } from "@/app-shell/line-editor";

import { CommandPalette, LineEditorText, useShellInput } from "./shell-command-ui";
import { ShellFooter } from "./shell-primitives";
import { palette, statusColor } from "./shell-theme";
import type { FooterAction, ShellAction, ShellFooterMode, ShellStatus } from "./types";
import type { AppCommandId, ResolvedAppCommand } from "./commands";

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
  useInput((input) => {
    if (input === "\x03") {
      if (process.stdin.isTTY) process.stdin.unref();
      process.exit(0);
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
  const sepWidth = Math.max(24, (stdout.columns ?? 80) - 4);

  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="white">
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
          />
        ) : null}

        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {"─".repeat(sepWidth)}
          </Text>
        </Box>

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
  onRedraw,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  hint?: string;
  onRedraw?: () => void;
}) {
  const { stdout } = useStdout();
  const wideField = (stdout.columns ?? 0) >= 112;
  const editor = useLineEditor({
    value,
    onChange,
    onSubmit,
    onRedraw,
  });

  useInput((input, key) => {
    if (!focus) return;
    if (input === "/" || key.escape || key.upArrow || key.downArrow || key.tab) {
      return;
    }
    editor.handleInput(input, key);
  });

  return (
    <Box marginTop={1} flexDirection="column">
      <Box justifyContent="space-between">
        <Text color={palette.muted}>{label}</Text>
        {hint && wideField ? (
          <Text color={palette.gray} dimColor>
            {hint}
          </Text>
        ) : null}
      </Box>
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={focus ? palette.cyan : palette.gray}
        paddingX={1}
      >
        <Text color={focus ? palette.cyan : palette.gray}>{focus ? "⌕ " : "› "}</Text>
        <LineEditorText
          value={value}
          cursor={editor.cursor}
          focused={focus}
          placeholder={placeholder}
        />
      </Box>
      {hint && !wideField ? (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {hint}
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
