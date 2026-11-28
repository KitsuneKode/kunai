import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled } from "../plain-mode";
import { sanitizeTerminalText, truncateLine } from "../shell-text";
import { palette } from "../shell-theme";
import type { ConfirmStripState } from "./ConfirmStrip.model";

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function stripLine(state: Exclude<ConfirmStripState, { kind: "idle" }>) {
  const label = sanitizeTerminalText(state.label);
  if (state.kind === "armed") {
    return {
      text: `⚠ ${capitalize(state.verb)} ${label}?`,
      color: palette.warn,
    };
  }
  if (state.kind === "executing") {
    const executing = state.executingLabel ?? `${capitalize(state.verb)} ${label}`;
    return { text: `◌ ${sanitizeTerminalText(executing)}…`, color: palette.accent };
  }
  return { text: `× ${sanitizeTerminalText(state.message)}`, color: palette.dangerText };
}

function plainStripLines(state: Exclude<ConfirmStripState, { kind: "idle" }>): readonly string[] {
  const label = sanitizeTerminalText(state.label);
  if (state.kind === "armed") {
    return [
      "Focus: Confirmation",
      `Confirm: ${capitalize(state.verb)} ${label}?`,
      `Actions: [y] ${state.verb}, [esc] cancel`,
    ];
  }
  if (state.kind === "executing") {
    const executing = state.executingLabel ?? `${capitalize(state.verb)} ${label}`;
    return [`Focus: Confirmation`, `Status: ${sanitizeTerminalText(executing)}…`];
  }
  return [
    "Focus: Confirmation",
    `Error: ${sanitizeTerminalText(state.message)}`,
    "Actions: [esc] dismiss",
  ];
}

/** Presentation for the destructive-confirmation state machine. */
export const ConfirmStrip = React.memo(function ConfirmStrip({
  state,
  width,
}: {
  readonly state: ConfirmStripState;
  readonly width?: number;
}) {
  if (state.kind === "idle") return null;
  if (plainModeEnabled()) {
    return (
      <Box flexDirection="column" marginTop={1}>
        {plainStripLines(state).map((line) => (
          <Text key={line} color={line.startsWith("Error:") ? palette.dangerText : palette.text}>
            {width ? truncateLine(line, width) : line}
          </Text>
        ))}
      </Box>
    );
  }
  const line = stripLine(state);
  return (
    <Box marginTop={1}>
      <Text color={line.color}>{width ? truncateLine(line.text, width) : line.text}</Text>
    </Box>
  );
});
