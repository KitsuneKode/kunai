import { Box, Text } from "ink";
import React from "react";

import { type ShellViewportKind, TRANSIENT_ROW_SLOTS } from "./layout-policy";
import { measureColumns, padColumnsEnd, truncateLine } from "./shell-text";
import { APP_LABEL, hotkeyLabel, palette, semanticToneColor } from "./shell-theme";
import type { FooterAction, ShellFooterMode } from "./types";
import { useDebouncedViewportPolicy, useShellDimensions } from "./use-viewport-policy";

type InlineBadgeTone = "neutral" | "info" | "success" | "warning" | "error";
type BadgeTone = "neutral" | "info" | "success" | "warning" | "error" | "accent";
const MINIMAL_FOOTER_ACTION_LIMIT = 4;
const DETAILED_FOOTER_ACTION_LIMIT = 5;
const DETAILED_FOOTER_VISIBLE_LIMIT = 4;

export { TRANSIENT_ROW_SLOTS };

/** Reserved row under AppHeader — always occupies layout budget even when empty. */
export function TransientRowSlot({
  children,
  width,
}: {
  children?: React.ReactNode;
  width?: number;
}) {
  const lineWidth = width ?? 40;
  return (
    <Box flexDirection="column">
      {children ?? (
        <Text color={palette.dim} dimColor>
          {truncateLine(" ", lineWidth)}
        </Text>
      )}
    </Box>
  );
}

/** Optional footer glyphs — off by default for calmer Claude Code–style footers. */
const FOOTER_GLYPHS: Record<string, string> = {};

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
    if (commandAction?.primary) {
      return [
        commandAction,
        ...enabledActions.filter((action) => action.action !== "command-mode"),
      ].slice(0, limit);
    }
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

    const capped = nonCommandActions.slice(0, primaryLimit);
    return commandAction ? [...capped, commandAction] : capped;
  }

  // Fallback: fixed limit
  const primaryActions = nonCommandActions.slice(
    0,
    commandAction ? DETAILED_FOOTER_VISIBLE_LIMIT : hardLimit,
  );
  return commandAction ? [...primaryActions, commandAction] : primaryActions;
}

export const InlineBadge = React.memo(function InlineBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: InlineBadgeTone;
}) {
  return (
    <Box marginRight={1}>
      <Text color={semanticToneColor(tone)}>{truncateLine(label, 28)}</Text>
    </Box>
  );
});

type FooterActionRole = "primary" | "destructive" | "meta" | "normal";

const DESTRUCTIVE_FOOTER = /\b(stop|quit|delete|remove|cancel|clear|discard)\b/i;
const META_FOOTER = /\b(commands?|help|menu)\b/i;

function footerActionRole(action: FooterAction): FooterActionRole {
  if (action.primary) return "primary";
  if (DESTRUCTIVE_FOOTER.test(action.label)) return "destructive";
  if (META_FOOTER.test(action.label)) return "meta";
  return "normal";
}

export function Footer({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
  maxVisible,
  terminalWidth: terminalWidthProp,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
  terminalWidth?: number;
}) {
  const { cols } = useShellDimensions();
  const terminalWidth = terminalWidthProp ?? cols;
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
        <Text color={palette.text}>{truncateLine(taskLabel, taskWidth)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold color={palette.text}>
            Command palette
          </Text>
          <Text color={palette.dim}>
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
      <Text color={palette.text}>{truncateLine(taskLabel, taskWidth)}</Text>
      {visibleActions.length > 0 ? (
        <Box flexWrap="nowrap" marginTop={1}>
          {visibleActions.map((action, index) => {
            const glyph = FOOTER_GLYPHS[action.key] ?? "";
            const keyDisplay = glyph ? `${glyph}§${action.key}` : action.key;
            // Tasteful 3-role hierarchy instead of one rose key + a wall of grey:
            //  • primary  → warm accent key + bright bold label
            //  • destructive (stop/quit/delete…) → danger key (reads as "careful")
            //  • meta (commands/help) → quiet muted
            //  • everything else → cool `info` counterweight key + dimmed label
            const role = footerActionRole(action);
            const keyColor =
              role === "primary"
                ? palette.accent
                : role === "destructive"
                  ? palette.danger
                  : role === "meta"
                    ? palette.muted
                    : palette.info;
            const labelColor =
              role === "primary" ? palette.text : role === "meta" ? palette.muted : palette.textDim;
            return (
              <Box
                key={`${action.key}-${action.label}`}
                marginRight={index === visibleActions.length - 1 ? 0 : 2}
                marginBottom={1}
              >
                <Text bold={role === "primary"} color={keyColor}>
                  {hotkeyLabel(keyDisplay)}
                </Text>
                <Text color={labelColor}> {truncateLine(action.label, 18)}</Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box marginTop={1} minHeight={1}>
          <Text color={palette.dim} dimColor>
            {truncateLine(" ", taskWidth)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function ShellFooter({
  taskLabel,
  actions,
  mode = "detailed",
  commandMode = false,
  maxVisible,
  terminalWidth,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
  terminalWidth?: number;
}) {
  return (
    <Footer
      taskLabel={taskLabel}
      actions={actions}
      mode={mode}
      commandMode={commandMode}
      maxVisible={maxVisible}
      terminalWidth={terminalWidth}
    />
  );
}

export const ResizeBlocker = React.memo(function ResizeBlocker({
  columns,
  rows,
  minColumns,
  minRows,
  message = "Terminal too small",
}: {
  columns: number;
  rows: number;
  minColumns: number;
  minRows: number;
  message?: string;
}) {
  return (
    <Box marginTop={1} flexDirection="column" paddingX={1}>
      <Text color={palette.accentDeep}>{message}</Text>
      <Text color={palette.muted}>
        {`Terminal is ${columns}×${rows}  ·  needs ${minColumns}×${minRows}`}
      </Text>
      <Text color={palette.dim}>Zoom out or resize the terminal window.</Text>
      <Box marginTop={1}>
        <Text color={palette.dim} dimColor>
          {APP_LABEL}
        </Text>
      </Box>
    </Box>
  );
});

/**
 * Shared viewport gate: renders the standard {@link ResizeBlocker} when the
 * terminal is below the usable minimum for `kind`, otherwise the children. Use
 * this so every surface (overlays, post-play, setup) blocks on the SAME size
 * threshold instead of each shell re-implementing (or skipping) the check.
 *
 * `tooSmall` is independent of zen mode, so the gate intentionally takes no zen
 * option — the minimum usable size is the same in every layout track.
 */
export const ViewportResizeGate = React.memo(function ViewportResizeGate({
  children,
  kind = "picker",
  message,
}: {
  children: React.ReactNode;
  kind?: ShellViewportKind;
  message?: string;
}) {
  const viewport = useDebouncedViewportPolicy(kind);
  if (viewport.tooSmall) {
    return (
      <ResizeBlocker
        columns={viewport.columns}
        rows={viewport.rows}
        minColumns={viewport.minColumns}
        minRows={viewport.minRows}
        message={message}
      />
    );
  }
  return <>{children}</>;
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
      <Text color={semanticToneColor(tone)}>{title}</Text>
      <Box marginTop={1} flexDirection="column">
        {children}
      </Box>
    </Box>
  );
});

type ContentKind = "anime" | "series" | "movie";

const CONTENT_FILL: Record<ContentKind, string> = {
  anime: palette.surfaceElevated,
  series: palette.surfaceElevated,
  movie: palette.surfaceElevated,
};

export const Badge = React.memo(function Badge({
  label,
  tone = "neutral",
  contentKind,
}: {
  label: string;
  tone?: BadgeTone;
  /** When set, the badge uses the content-type tint + fill, overriding tone. */
  contentKind?: ContentKind;
}) {
  if (contentKind) {
    return (
      <Box marginRight={1}>
        <Text color={palette.muted} backgroundColor={CONTENT_FILL[contentKind]}>
          {` ${truncateLine(label, 26)} `}
        </Text>
      </Box>
    );
  }

  const color =
    tone === "success"
      ? palette.ok
      : tone === "info"
        ? palette.muted
        : tone === "accent"
          ? palette.accentSoft
          : tone === "error"
            ? palette.danger
            : tone === "warning"
              ? palette.accentDeep
              : palette.dim;

  return (
    <Box marginRight={1}>
      <Text color={color} bold={tone !== "neutral"}>
        {truncateLine(label, 26)}
      </Text>
    </Box>
  );
});

export type SelectableRowStyle = {
  readonly prefix: string;
  readonly color: string;
  readonly backgroundColor?: string;
};

/** The single selection treatment: accent rule + accent-tinted fill. */
export function selectableRowStyle(selected: boolean): SelectableRowStyle {
  if (selected) {
    return { prefix: "▌", color: palette.accentSoft, backgroundColor: palette.accentFill };
  }
  return { prefix: "  ", color: palette.text };
}

export const SelectableRow = React.memo(function SelectableRow({
  selected,
  children,
}: {
  selected: boolean;
  children: React.ReactNode;
}) {
  const style = selectableRowStyle(selected);
  return (
    <Box>
      <Text color={selected ? palette.accent : palette.dim} backgroundColor={style.backgroundColor}>
        {style.prefix}
      </Text>
      <Text color={style.color} backgroundColor={style.backgroundColor}>
        {children}
      </Text>
    </Box>
  );
});

/** Pads (or truncates) the label to a fixed column for tabular detail rows. */
export function detailRowColumns(
  label: string,
  value: string,
  labelWidth: number,
): { label: string; value: string } {
  const trimmed =
    measureColumns(label) > labelWidth
      ? truncateLine(label, labelWidth)
      : padColumnsEnd(label, labelWidth);
  return { label: trimmed, value };
}

export const DetailRow = React.memo(function DetailRow({
  label,
  value,
  labelWidth = 12,
  tone = "neutral",
}: {
  label: string;
  value: string;
  labelWidth?: number;
  tone?: BadgeTone;
}) {
  const cols = detailRowColumns(label, value, labelWidth);
  const valueColor =
    tone === "success"
      ? palette.ok
      : tone === "info"
        ? palette.muted
        : tone === "accent"
          ? palette.accentSoft
          : tone === "error"
            ? palette.danger
            : tone === "warning"
              ? palette.accentDeep
              : palette.text;
  return (
    <Box>
      <Text color={palette.muted}>{cols.label}</Text>
      <Text color={valueColor}> {cols.value}</Text>
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
      {visibleItems.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <Text color={palette.dim}> · </Text> : null}
          <Text color={semanticToneColor(item.tone)}>{truncateLine(item.label, 34)}</Text>
        </React.Fragment>
      ))}
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
    tone === "accent" ? palette.accentSoft : tone === "neutral" ? "white" : semanticToneColor(tone);

  return (
    <Box>
      <Text color={palette.dim}>{label}</Text>
      <Text color={palette.dim}> · </Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
});

export const BrowseTitle = React.memo(function BrowseTitle({ mode }: { mode: "series" | "anime" }) {
  return (
    <Text bold color={palette.text}>
      {mode === "anime" ? "Browse your favorite anime" : "Browse your favorite movies and series"}
    </Text>
  );
});

/**
 * Designed empty state for panels with no data.
 * Provides a consistent visual treatment across the shell instead of raw dim text.
 */
export function TerminalSizeChip({ columns, rows }: { columns: number; rows: number }) {
  const isBlocked = columns < 60 || rows < 20;
  const isSuboptimal = !isBlocked && columns < 80;
  const color = isBlocked ? palette.danger : isSuboptimal ? palette.accentDeep : palette.dim;
  return (
    <Text color={color} dimColor={!isBlocked && !isSuboptimal}>
      {columns}×{rows}
    </Text>
  );
}

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
      <Text color={palette.dim}>
        {icon} {title}
      </Text>
      {subtitle ? <Text color={palette.muted}>{subtitle}</Text> : null}
      {hint ? (
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            {hint}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
