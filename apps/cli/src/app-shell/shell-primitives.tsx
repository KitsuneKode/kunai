import { Box, Text } from "ink";
import React from "react";

import { companionMode, companionToggleable } from "./companion-policy";
import { type ShellViewportKind, TRANSIENT_ROW_SLOTS } from "./layout-policy";
import { footerKeySequence } from "./mouse/footer-key-sequence";
import { MouseTarget, usePressKey } from "./mouse/MouseRegions";
import { plainBrandLabel, plainModeEnabled, selectionPrefix } from "./plain-mode";
import { measureColumns, padColumnsEnd, sanitizeTerminalText, truncateLine } from "./shell-text";
import { hotkeyLabel, palette, semanticToneColor } from "./shell-theme";
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

/**
 * The way back after `/pet` — rendered as an action hint, not a control.
 * `action` names the real command so the footer selector can pin it: appended
 * last, it would lose every slot race, and it is the only in-shell route back
 * once she is hidden.
 */
const PET_RESTORE_ACTION = { key: "/pet", label: "kanna", action: "pet" } as const;

const NARROW_FOOTER_WIDTH = 64;
const NARROW_FOOTER_ACTION_LIMIT = 3;

export function footerDisplayLabel(action: FooterAction, terminalWidth?: number): string {
  if (!terminalWidth || terminalWidth >= NARROW_FOOTER_WIDTH) return action.label;
  const compactLabel = action.label.split(" · ")[0] ?? action.label;
  if (terminalWidth < 48 && action.action === "command-mode" && compactLabel === "commands") {
    return "cmds";
  }
  return compactLabel;
}

function footerActionColumns(action: FooterAction, terminalWidth: number): number {
  return (
    measureColumns(hotkeyLabel(action.key)) +
    1 +
    measureColumns(footerDisplayLabel(action, terminalWidth))
  );
}

function criticalStopAction(action: FooterAction): boolean {
  return action.action === "quit" && action.key.trim().toLowerCase() === "q";
}

function narrowFooterActions(
  pool: readonly FooterAction[],
  terminalWidth: number,
  poolLimit: number,
): readonly FooterAction[] {
  const commandAction = pool.find((action) => action.action === "command-mode");
  const nonCommandActions = pool.filter((action) => action.action !== "command-mode");
  const criticalStop = nonCommandActions.find(criticalStopAction);
  const candidates: FooterAction[] = [];
  const addCandidate = (action: FooterAction | undefined) => {
    if (action && !candidates.includes(action)) candidates.push(action);
  };
  // Surface order is the fallback. Narrow chrome has three explicit priority
  // classes before it: destructive stop is safety chrome, narrow-essential
  // navigation must not disappear, and the primary action is the next-best
  // recovery path when even those do not fit.
  addCandidate(criticalStop);
  for (const action of nonCommandActions) {
    if (action.narrowEssential) addCandidate(action);
  }
  addCandidate(nonCommandActions.find((action) => action.primary));
  for (const action of nonCommandActions) addCandidate(action);

  const nonCommandLimit = Math.max(0, poolLimit - (commandAction ? 1 : 0));
  const widthBudget = Math.max(18, terminalWidth - 2);
  const commandColumns = commandAction ? footerActionColumns(commandAction, terminalWidth) : 0;
  const selected: FooterAction[] = [];
  let selectedColumns = 0;
  for (const candidate of candidates) {
    if (selected.length >= nonCommandLimit) break;
    const candidateColumns = footerActionColumns(candidate, terminalWidth);
    const count = selected.length + 1 + (commandAction ? 1 : 0);
    const totalColumns =
      selectedColumns + candidateColumns + commandColumns + Math.max(0, count - 1) * 2;
    if (totalColumns > widthBudget) continue;
    selected.push(candidate);
    selectedColumns += candidateColumns;
  }
  const firstCandidate = candidates[0];
  if (selected.length === 0 && firstCandidate && nonCommandLimit > 0) {
    selected.push(firstCandidate);
  }
  return commandAction ? [...selected, commandAction] : selected;
}

export type ContextStripItem = {
  label: string;
  tone?: InlineBadgeTone;
};

/**
 * Empty-list footer grammar. Row-scoped hints (`requiresSelection`) vanish when
 * there is no row they can act on; navigation, palette, and close affordances
 * stay because they still work. Callers mark scope at the binding/footer model
 * instead of every surface re-learning which keys are dead.
 */
export function emptySafeFooterActions(
  actions: readonly FooterAction[],
  hasRows: boolean,
): readonly FooterAction[] {
  if (hasRows) return actions;
  return actions.filter((action) => action.requiresSelection !== true);
}

export function selectFooterActions(
  actions: readonly FooterAction[],
  mode: ShellFooterMode,
  terminalWidth?: number,
  maxVisible?: number,
): readonly FooterAction[] {
  const enabledActions = actions.filter((action) => !action.disabled);

  const hardLimit = maxVisible ?? DETAILED_FOOTER_ACTION_LIMIT;

  // The pet-restore hint is pinned: it is the only in-shell route back once
  // the fox is hidden, so letting it lose the slot race — which appended-last
  // guaranteed at any sane width — would remove the feature it advertises.
  // It is pinned *inside* the budget: each cap below reserves a slot for it so
  // the row stays within the same width the limit was tuned for.
  const pinnedRestore = enabledActions.filter((action) => action.action === "pet");
  const pool = enabledActions.filter((action) => action.action !== "pet");
  const pinnedCount = pinnedRestore.length;
  const withPinned = (list: readonly FooterAction[]) => [...list, ...pinnedRestore];

  if (terminalWidth && terminalWidth > 0 && terminalWidth < NARROW_FOOTER_WIDTH) {
    const poolLimit = Math.max(1, Math.min(NARROW_FOOTER_ACTION_LIMIT, hardLimit) - pinnedCount);
    return withPinned(narrowFooterActions(pool, terminalWidth, poolLimit));
  }

  if (mode === "minimal") {
    const limit = Math.min(MINIMAL_FOOTER_ACTION_LIMIT, hardLimit);
    const poolLimit = Math.max(1, limit - pinnedCount);
    const commandAction = pool.find((action) => action.action === "command-mode");
    if (commandAction?.primary) {
      return withPinned(
        [commandAction, ...pool.filter((action) => action.action !== "command-mode")].slice(
          0,
          poolLimit,
        ),
      );
    }
    const primaryActions = pool
      .filter((action) => action.action !== "command-mode")
      .slice(0, commandAction ? Math.max(0, poolLimit - 1) : poolLimit);
    return withPinned(commandAction ? [...primaryActions, commandAction] : primaryActions);
  }

  // Detailed mode: keep the persistent footer glanceable. Deeper actions belong
  // behind / commands so the footer never turns into a wrapped command paragraph.
  const commandAction = pool.find((action) => action.action === "command-mode");
  const nonCommandActions = pool.filter((action) => action.action !== "command-mode");

  if (terminalWidth && terminalWidth > 0) {
    const widthLimit =
      terminalWidth < 92 ? 2 : terminalWidth < 132 ? 3 : DETAILED_FOOTER_VISIBLE_LIMIT;
    const primaryLimit = Math.min(hardLimit, Math.max(1, widthLimit - pinnedCount));

    const capped = nonCommandActions.slice(0, primaryLimit);
    return withPinned(commandAction ? [...capped, commandAction] : capped);
  }

  // Fallback: fixed limit
  const primaryActions = nonCommandActions.slice(
    0,
    Math.max(1, (commandAction ? DETAILED_FOOTER_VISIBLE_LIMIT : hardLimit) - pinnedCount),
  );
  return withPinned(commandAction ? [...primaryActions, commandAction] : primaryActions);
}

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
  companionHint = false,
  onActivate,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
  terminalWidth?: number;
  /**
   * Surfaces whose command context offers /pet opt in here. Playback,
   * post-play, and picker footers do not list the command, so advertising it
   * there would promise a control the palette cannot deliver.
   */
  companionHint?: boolean;
  onActivate?: (action: FooterAction) => void;
}) {
  const footerId = React.useId();
  const pressKey = usePressKey();
  // A chip with a wired action runs it. Any other chip naming a real key
  // presses that key — the surface's own handler decides, so a click means
  // exactly what the key means. Destructive chips (delete, stop, clear…) stay
  // keyboard-only: mouse navigation never deletes or removes.
  const activateFooter = (
    action: FooterAction,
    role: FooterActionRole,
  ): (() => void) | undefined => {
    if (action.disabled) return undefined;
    if (onActivate && action.action) return () => onActivate(action);
    const keys =
      pressKey && (role !== "destructive" || action.allowMouseDestructive === true)
        ? footerKeySequence(action.key)
        : null;
    return keys && pressKey ? () => pressKey(keys) : undefined;
  };
  const { cols } = useShellDimensions();
  const terminalWidth = terminalWidthProp ?? cols;
  const taskWidth = Math.max(20, terminalWidth - 4);
  // Kanna removed via /pet or settings leaves a way back on surfaces that offer
  // the command: a display-only hint naming it. selectFooterActions keeps it
  // inside the width budget — it is the only restore affordance, so it cannot
  // lose the slot race — and it hides entirely when an env pin makes the
  // toggle a dead control.
  const kannaHidden = companionHint && companionMode() === "off" && companionToggleable();
  const visibleActions = React.useMemo(
    () =>
      selectFooterActions(
        kannaHidden ? [...actions, PET_RESTORE_ACTION] : actions,
        mode,
        terminalWidth,
        maxVisible,
      ),
    [actions, kannaHidden, mode, terminalWidth, maxVisible],
  );

  // The palette owns its editor and navigation hints.
  if (commandMode) return null;

  if (plainModeEnabled()) {
    const actionLine = visibleActions
      .map((action) => `${hotkeyLabel(action.key)} ${action.label}`)
      .join(", ");
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.text}>{truncateLine(taskLabel, taskWidth)}</Text>
        {actionLine ? <Text color={palette.muted}>{`Actions: ${actionLine}`}</Text> : null}
      </Box>
    );
  }

  const narrowFooter = terminalWidth < NARROW_FOOTER_WIDTH;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.text}>{truncateLine(taskLabel, taskWidth)}</Text>
      {visibleActions.length > 0 ? (
        <Box flexWrap={narrowFooter ? "nowrap" : "wrap"} marginTop={narrowFooter ? 0 : 1}>
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
                  ? palette.dangerText
                  : role === "meta"
                    ? palette.muted
                    : palette.info;
            const labelColor =
              role === "primary" ? palette.text : role === "meta" ? palette.muted : palette.textDim;
            return (
              <MouseTarget
                id={`${footerId}:footer:${action.key}:${action.action ?? "hint"}:${action.label}`}
                active={Boolean(activateFooter(action, role))}
                onClick={activateFooter(action, role)}
                feedback={Boolean(activateFooter(action, role))}
                key={`${action.key}-${action.label}`}
              >
                <Box
                  marginRight={index === visibleActions.length - 1 ? 0 : 2}
                  marginBottom={narrowFooter ? 0 : 1}
                >
                  <Text bold={role === "primary"} color={keyColor}>
                    {hotkeyLabel(keyDisplay)}
                  </Text>
                  <Text color={labelColor}>
                    {" "}
                    {truncateLine(footerDisplayLabel(action, terminalWidth), 28)}
                  </Text>
                </Box>
              </MouseTarget>
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
  companionHint = false,
  onActivate,
}: {
  taskLabel: string;
  actions: readonly FooterAction[];
  mode?: ShellFooterMode;
  commandMode?: boolean;
  maxVisible?: number;
  terminalWidth?: number;
  companionHint?: boolean;
  onActivate?: (action: FooterAction) => void;
}) {
  return (
    <Footer
      taskLabel={taskLabel}
      actions={actions}
      mode={mode}
      commandMode={commandMode}
      maxVisible={maxVisible}
      terminalWidth={terminalWidth}
      companionHint={companionHint}
      onActivate={onActivate}
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
          {plainBrandLabel()}
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
      <Text color={semanticToneColor(tone)}>{sanitizeTerminalText(title)}</Text>
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
            ? palette.dangerText
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

/** The single selection treatment: accent rule + accent-tinted fill (or `[selected] ` in plain mode). */
export function selectableRowStyle(selected: boolean): SelectableRowStyle {
  if (plainModeEnabled()) {
    return { prefix: selectionPrefix(selected, true), color: palette.text };
  }
  if (selected) {
    return { prefix: "▌", color: palette.accentSoft, backgroundColor: palette.accentFill };
  }
  return { prefix: "  ", color: palette.text };
}

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
            ? palette.dangerText
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
  const plain = plainModeEnabled();
  const visibleItems = items.filter((item) => item.label.trim().length > 0);
  if (visibleItems.length === 0) return null;

  return (
    <Box flexWrap="wrap">
      {visibleItems.map((item, index) => (
        <React.Fragment key={item.label}>
          {index > 0 ? <Text color={palette.dim}>{plain ? ", " : " · "}</Text> : null}
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
  const plain = plainModeEnabled();
  const valueColor =
    tone === "accent"
      ? palette.accentSoft
      : tone === "neutral"
        ? palette.text
        : semanticToneColor(tone);

  return (
    <Box>
      <Text color={palette.dim}>{sanitizeTerminalText(label)}</Text>
      <Text color={palette.dim}>{plain ? ": " : " · "}</Text>
      <Text color={valueColor}>{truncateLine(value, 80)}</Text>
    </Box>
  );
});
