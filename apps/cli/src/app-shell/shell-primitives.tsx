import { Box, Text, useStdout } from "ink";
import React from "react";

import { truncateLine } from "./shell-text";
import { hotkeyLabel, palette } from "./shell-theme";
import type { FooterAction, ShellFooterMode } from "./types";

type InlineBadgeTone = "neutral" | "info" | "success" | "warning" | "error";
type BadgeTone = "neutral" | "info" | "success" | "warning" | "error" | "accent";
const MINIMAL_FOOTER_ACTION_LIMIT = 4;
const DETAILED_FOOTER_ACTION_LIMIT = 5;
const DETAILED_FOOTER_VISIBLE_LIMIT = 4;

/** Unicode glyphs for footer action keys — makes the footer feel like a cockpit. */
const FOOTER_GLYPHS: Record<string, string> = {
  n: "⏭",
  p: "⏮",
  r: "↻",
  a: "▶",
  u: "↷",
  d: "⬇",
  o: "◈",
  v: "◆",
  k: "≋",
  s: "⌕",
  q: "✕",
  f: "⤳",
  "/": "⌘",
  e: "☰",
  g: "★",
  h: "⏱",
  "?": "?",
  i: "◉",
  enter: "↵",
  esc: "←",
  "^D": "⬇",
  "^T": "⬡",
  tab: "⇥",
};

/**
 * Compute which footer actions fit within available terminal width.
 * Returns visible actions and a count of overflowed ones.
 */
function computeVisibleActions(
  actions: readonly FooterAction[],
  terminalWidth: number,
): { visible: readonly FooterAction[]; overflowCount: number } {
  // Reserve 16 chars for the overflow indicator and margins
  const budget = Math.max(30, terminalWidth - 16);
  let used = 0;
  const visible: FooterAction[] = [];

  for (const action of actions) {
    const glyph = FOOTER_GLYPHS[action.key] ?? action.key;
    // Rendered width: [glyph key] label  (with trailing space)
    const width = `[${glyph} ${action.key}] ${action.label}  `.length;
    if (used + width > budget && visible.length > 0) break;
    visible.push(action);
    used += width;
  }

  return { visible, overflowCount: actions.length - visible.length };
}

export type ContextStripItem = {
  label: string;
  tone?: InlineBadgeTone;
};

export function selectFooterActions(
  actions: readonly FooterAction[],
  mode: ShellFooterMode,
  terminalWidth?: number,
  maxVisible?: number,
): readonly FooterAction[] {
  const enabledActions = actions.filter((action) => !action.disabled);

  const hardLimit = maxVisible ?? DETAILED_FOOTER_ACTION_LIMIT;

  if (mode === "minimal") {
    const limit = Math.min(MINIMAL_FOOTER_ACTION_LIMIT, hardLimit);
    const commandAction = enabledActions.find((action) => action.action === "command-mode");
    const primaryActions = enabledActions
      .filter((action) => action.action !== "command-mode")
      .slice(0, commandAction ? limit - 1 : limit);
    return commandAction ? [...primaryActions, commandAction] : primaryActions;
  }

  // Detailed mode: keep the persistent footer glanceable. Deeper actions belong
  // behind / commands so the footer never turns into a wrapped command paragraph.
  const commandAction = enabledActions.find((action) => action.action === "command-mode");
  const nonCommandActions = enabledActions.filter((action) => action.action !== "command-mode");

  if (terminalWidth && terminalWidth > 0) {
    const widthLimit =
      terminalWidth < 92 ? 2 : terminalWidth < 132 ? 3 : DETAILED_FOOTER_VISIBLE_LIMIT;
    const primaryLimit = Math.min(hardLimit, Math.max(1, widthLimit));

    if (nonCommandActions.length > primaryLimit) {
      const hiddenCount = nonCommandActions.length - primaryLimit;
      return [
        ...nonCommandActions.slice(0, primaryLimit),
        {
          key: commandAction?.key ?? "/",
          label: `+${hiddenCount} more`,
          action: "command-mode" as const,
        },
      ];
    }

    const visible = commandAction ? [...nonCommandActions, commandAction] : nonCommandActions;
    const { visible: widthVisible, overflowCount } = computeVisibleActions(visible, terminalWidth);
    if (overflowCount > 0) {
      return [
        ...widthVisible.filter((action) => action.action !== "command-mode"),
        {
          key: commandAction?.key ?? "/",
          label: `+${overflowCount} more`,
          action: "command-mode" as const,
        },
      ].slice(0, primaryLimit + 1);
    }
    return widthVisible;
  }

  // Fallback: fixed limit
  const primaryActions = nonCommandActions.slice(
    0,
    commandAction ? DETAILED_FOOTER_VISIBLE_LIMIT : hardLimit,
  );
  const hiddenCount = enabledActions.length - primaryActions.length - (commandAction ? 1 : 0);
  const result = commandAction ? [...primaryActions, commandAction] : primaryActions;
  if (hiddenCount > 0) {
    result.push({ key: "/", label: `+${hiddenCount} more`, action: "command-mode" });
  }
  return result;
}

export const InlineBadge = React.memo(function InlineBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: InlineBadgeTone;
}) {
  const color =
    tone === "info"
      ? palette.info
      : tone === "success"
        ? palette.green
        : tone === "warning"
          ? palette.amber
          : tone === "error"
            ? palette.red
            : palette.muted;

  return (
    <Box marginRight={1}>
      <Text color={color}>{truncateLine(label, 28)}</Text>
    </Box>
  );
});

export function Footer({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
  maxVisible,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
}) {
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns ?? 100;
  const taskWidth = Math.max(20, terminalWidth - 4);
  const visibleActions = React.useMemo(
    () =>
      selectFooterActions(
        actions,
        mode,
        mode === "detailed" ? terminalWidth : undefined,
        maxVisible,
      ),
    [actions, mode, terminalWidth, maxVisible],
  );

  if (commandMode) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="white">{truncateLine(taskLabel, taskWidth)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.amber}>Command palette</Text>
          <Text color={palette.gray}>
            {truncateLine(
              "Type to search · Tab autocomplete · ↑↓ choose · Enter run · Esc close",
              taskWidth,
            )}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="white">{truncateLine(taskLabel, taskWidth)}</Text>
      {visibleActions.length > 0 ? (
        <Box flexWrap="nowrap" marginTop={1}>
          {visibleActions.map((action, index) => {
            const glyph = FOOTER_GLYPHS[action.key] ?? "";
            const keyDisplay = glyph ? `${glyph} ${action.key}` : action.key;
            return (
              <Box
                key={`${action.key}-${action.label}`}
                marginRight={index === visibleActions.length - 1 ? 0 : 2}
                marginBottom={1}
              >
                <Text color={palette.dim}>{hotkeyLabel(keyDisplay)}</Text>
                <Text color={palette.textDim}> {truncateLine(action.label, 18)}</Text>
              </Box>
            );
          })}
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
  maxVisible,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
}) {
  return (
    <Footer
      taskLabel={taskLabel}
      actions={actions}
      mode={mode}
      commandMode={commandMode}
      maxVisible={maxVisible}
    />
  );
}

export const ResizeBlocker = React.memo(function ResizeBlocker({
  minColumns,
  minRows,
  message = "Terminal too small",
}: {
  minColumns: number;
  minRows: number;
  message?: string;
}) {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 0;
  const rows = stdout.rows ?? 0;

  return (
    <Box marginTop={1} flexDirection="column" paddingX={1}>
      <Text color={palette.amber}>{message}</Text>
      <Text color={palette.muted}>
        {`Terminal is ${cols}×${rows}  ·  needs ${minColumns}×${minRows}`}
      </Text>
      <Text color={palette.dim}>Zoom out or resize the terminal window.</Text>
    </Box>
  );
});

export const LocalSection = React.memo(function LocalSection({
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
            ? palette.info
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
});

export const Badge = React.memo(function Badge({
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
        ? palette.info
        : tone === "accent"
          ? palette.amberSoft
          : tone === "error"
            ? palette.red
            : tone === "warning"
              ? palette.amber
              : palette.gray;

  return (
    <Box marginRight={1}>
      <Text color={color} bold={tone !== "neutral"}>
        {truncateLine(label, 26)}
      </Text>
    </Box>
  );
});

export const ContextStrip = React.memo(function ContextStrip({
  items,
}: {
  items: readonly ContextStripItem[];
}) {
  const visibleItems = items.filter((item) => item.label.trim().length > 0);
  if (visibleItems.length === 0) return null;

  return (
    <Box flexWrap="wrap">
      {visibleItems.map((item, index) => {
        const color =
          item.tone === "info"
            ? palette.info
            : item.tone === "success"
              ? palette.green
              : item.tone === "warning"
                ? palette.amber
                : item.tone === "error"
                  ? palette.red
                  : palette.muted;

        return (
          <React.Fragment key={item.label}>
            {index > 0 ? <Text color={palette.gray}> · </Text> : null}
            <Text color={color}>{truncateLine(item.label, 34)}</Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
});

export const DetailLine = React.memo(function DetailLine({
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
        ? palette.info
        : tone === "accent"
          ? palette.amberSoft
          : tone === "error"
            ? palette.red
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
});

export const BrowseTitle = React.memo(function BrowseTitle({ mode }: { mode: "series" | "anime" }) {
  return (
    <Text bold color="white">
      {mode === "anime" ? "Browse your favorite anime" : "Browse your favorite movies and series"}
    </Text>
  );
});

/**
 * Designed empty state for panels with no data.
 * Provides a consistent visual treatment across the shell instead of raw dim text.
 */
export const EmptyState = React.memo(function EmptyState({
  icon = "○",
  title,
  subtitle,
  hint,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  hint?: string;
}) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color={palette.gray}>
        {icon} {title}
      </Text>
      {subtitle ? <Text color={palette.muted}>{subtitle}</Text> : null}
      {hint ? (
        <Box marginTop={1}>
          <Text color={palette.gray} dimColor>
            {hint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
