import React from "react";
import { Box, Text } from "ink";

import type { FooterAction, ShellFooterMode } from "./types";
import { hotkeyLabel, palette } from "./shell-theme";

type InlineBadgeTone = "neutral" | "info" | "success" | "warning" | "error";
type BadgeTone = "neutral" | "info" | "success" | "warning" | "accent";

export function InlineBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: InlineBadgeTone;
}) {
  const color =
    tone === "info"
      ? palette.cyan
      : tone === "success"
        ? palette.green
        : tone === "warning"
          ? palette.amber
          : tone === "error"
            ? palette.red
            : palette.muted;

  return (
    <Box marginRight={1}>
      <Text color={color}>{label}</Text>
    </Box>
  );
}

export function Footer({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
}) {
  const visibleActions =
    mode === "minimal"
      ? actions.filter((action) => !action.disabled).slice(0, 3)
      : actions.filter((action) => !action.disabled);

  if (commandMode) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="white">{taskLabel}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.amber}>Command palette</Text>
          <Text color={palette.gray}>
            {" "}
            · Type to search · Tab autocomplete · ↑↓ choose · Enter run · Esc close
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="white">{taskLabel}</Text>
      {visibleActions.length > 0 ? (
        <Box flexWrap="wrap" marginTop={1}>
          {visibleActions.map((action, index) => (
            <Box
              key={`${action.key}-${action.label}`}
              marginRight={index === visibleActions.length - 1 ? 0 : 2}
              marginBottom={1}
            >
              <Text color={palette.cyan}>{hotkeyLabel(action.key)}</Text>
              <Text color="white"> {action.label}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function ShellFooter({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
}) {
  return <Footer taskLabel={taskLabel} actions={actions} mode={mode} commandMode={commandMode} />;
}

export function ResizeBlocker({
  minColumns,
  minRows,
  message = "Resize terminal to continue",
}: {
  minColumns: number;
  minRows: number;
  message?: string;
}) {
  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.red}
      paddingX={1}
    >
      <Text color={palette.red}>{message}</Text>
      <Text color={palette.muted}>
        {`Need at least ${minColumns} columns × ${minRows} rows for this view.`}
      </Text>
      <Text color={palette.gray}>Resize the terminal, then continue.</Text>
    </Box>
  );
}

export function LocalSection({
  title,
  tone = "neutral",
  children,
  marginTop = 1,
}: {
  title: string;
  tone?: InlineBadgeTone;
  children: React.ReactNode;
  marginTop?: number;
}) {
  return (
    <Box marginTop={marginTop} flexDirection="column">
      <Text
        color={
          tone === "info"
            ? palette.cyan
            : tone === "success"
              ? palette.green
              : tone === "warning"
                ? palette.amber
                : tone === "error"
                  ? palette.red
                  : palette.muted
        }
      >
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
}

export function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const color =
    tone === "success"
      ? palette.green
      : tone === "info"
        ? palette.cyan
        : tone === "accent"
          ? palette.rose
          : tone === "warning"
            ? palette.amber
            : palette.gray;

  return (
    <Box borderStyle="round" borderColor={color} paddingX={1} marginRight={1}>
      <Text color={color} bold={tone !== "neutral"}>
        {label}
      </Text>
    </Box>
  );
}

export function DetailLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: BadgeTone;
}) {
  const valueColor =
    tone === "success"
      ? palette.green
      : tone === "info"
        ? palette.cyan
        : tone === "accent"
          ? palette.rose
          : tone === "warning"
            ? palette.amber
            : "white";

  return (
    <Box>
      <Text color={palette.gray}>{label}</Text>
      <Text color={palette.gray}> · </Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

export function BrowseTitle({ mode }: { mode: "series" | "anime" }) {
  return (
    <Text bold color="white">
      {mode === "anime" ? "Browse your favorite anime" : "Browse your favorite movies and series"}
    </Text>
  );
}
