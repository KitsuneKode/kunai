import { resolveContentKind, showsEpisodeLabel } from "@/domain/media/content-kind";
import type { ErrorScenario } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import { Box, Text, useInput } from "ink";
import React from "react";

import { extractErrorDebugExcerpt } from "./error-debug-excerpt";
import {
  GUTTER_COLUMN,
  PETAL_STEP_MS,
  type PetalPlacement,
  petalsForFrame,
  settledFrame,
} from "./petal-fall";
import { buildErrorRows, type ErrorRow, type ErrorRowTone, rowText } from "./playback-error-rows";
import type { PlaybackFailureWaterfallModel } from "./playback-failure-waterfall";
import { reducedMotionEnabled, useFrameTick } from "./primitives/SakuraPetal";
import { SakuraLoader } from "./SakuraLoader";
import { palette } from "./shell-theme";
import { useShellDimensions } from "./use-viewport-policy";

export type { ErrorScenario } from "@/domain/playback/playback-problem";

export function RootIdleShell({ state }: { state: SessionState }) {
  const currentTitle = state.currentTitle;

  // A bootstrap `-S` search runs before any browse shell exists, so this idle
  // surface is what is on screen while it resolves. Without this branch the
  // root chrome said "searching" over a welcome screen that gave no sign of
  // work in flight -- the loader lives in the browse shell, which is not
  // mounted yet. Reuses the shared loader rather than inventing a second one.
  if (state.searchState === "loading") {
    const query = state.searchQuery.trim();
    return (
      <Box flexDirection="column" flexGrow={1}>
        <SakuraLoader
          label={query.length > 0 ? `Searching ${query}…` : "Searching…"}
          sublabel="esc to cancel"
        />
      </Box>
    );
  }

  // A title was selected but playback has not started yet. `SELECT_TITLE` sets
  // `view: "details"` with `playbackStatus: "idle"`, and every playback path —
  // movie or series — later dispatches `SELECT_EPISODE`, which flips the view to
  // "playback"; so `view === "details"` is reached only during that resolve
  // window and never on a resting/paused session (which sits at "playback").
  // Without this branch the idle surface showed the static session view with no
  // sign of work in flight — the same gap the search branch above closes, one
  // step later in the flow.
  if (currentTitle && state.view === "details") {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <SakuraLoader
          label={`Preparing ${currentTitle.name}…`}
          sublabel="Resolving sources · esc to cancel"
        />
      </Box>
    );
  }
  const hasSession = !!currentTitle;
  const currentEpisode =
    state.currentEpisode && showsEpisodeLabel(currentTitle)
      ? `S${String(state.currentEpisode.season).padStart(2, "0")}E${String(
          state.currentEpisode.episode,
        ).padStart(2, "0")}`
      : null;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {hasSession ? (
        <Box flexDirection="column" gap={0}>
          <Text color={palette.dim} dimColor>
            {resolveContentKind(currentTitle, state.mode)}
          </Text>
          <Box marginTop={1}>
            <Text color={palette.accent}>{"⏸  "}</Text>
            <Text color={palette.text} bold>
              {currentTitle?.name ?? "Current session"}
            </Text>
            {currentEpisode ? <Text color={palette.muted}>{`  ${currentEpisode}`}</Text> : null}
          </Box>
          <Box marginTop={1}>
            <Text color={palette.dim} dimColor>
              {"/history to continue  ·  /calendar for today  ·  / for commands"}
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0}>
          <Text color={palette.text} bold>
            {"◈  welcome to kunai"}
          </Text>
          <Box marginTop={1}>
            <Text color={palette.dim}>
              {"search for a title to begin  ·  /discover for recommendations"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/** Text begins here; column 0 is the gutter and column 1 is its trailing space. */
const TEXT_COLUMN = 2;
/** Chrome around the panel's inner content: border + padding on both sides. */
const PANEL_CHROME = 6;
const MIN_PANEL_WIDTH = 30;
const MAX_PANEL_WIDTH = 76;

type Cell = { readonly ch: string; readonly color: string; readonly bold: boolean };

function toneColor(tone: ErrorRowTone): string {
  switch (tone) {
    case "danger-strong":
    case "danger":
      return palette.danger;
    case "accent":
      return palette.accent;
    case "text":
      return palette.text;
    case "ok":
      return palette.ok;
    case "muted":
      return palette.muted;
    default:
      return palette.dim;
  }
}

/**
 * Lay a row's text into a cell buffer, then drop this row's petals into it.
 * Petals are written LAST and only into cells the text left empty, so a petal
 * can never lengthen the row — which is what makes reflow impossible rather
 * than merely unlikely.
 */
function rowCells(row: ErrorRow, petals: readonly PetalPlacement[], width: number): Cell[] {
  const cells: Cell[] = [{ ch: "│", color: palette.dangerDim, bold: false }];
  while (cells.length < TEXT_COLUMN) {
    cells.push({ ch: " ", color: palette.dim, bold: false });
  }

  for (const segment of row.segments) {
    const color = toneColor(segment.tone);
    const bold = segment.tone === "danger-strong";
    for (const ch of segment.text) {
      if (cells.length >= width) break;
      cells.push({ ch, color, bold });
    }
  }

  for (const petal of petals) {
    if (petal.column >= width) continue;
    while (cells.length <= petal.column) {
      cells.push({ ch: " ", color: palette.dim, bold: false });
    }
    if (cells[petal.column]?.ch !== " " && petal.column !== GUTTER_COLUMN) continue;
    cells[petal.column] = { ch: petal.glyph, color: petal.color, bold: true };
  }

  return cells;
}

/** Collapse a cell buffer into as few <Text> runs as the colors allow. */
function ErrorRowLine({
  row,
  petals,
  width,
}: {
  readonly row: ErrorRow;
  readonly petals: readonly PetalPlacement[];
  readonly width: number;
}) {
  const cells = rowCells(row, petals, width);
  const runs: { text: string; color: string; bold: boolean }[] = [];
  for (const cell of cells) {
    const last = runs.at(-1);
    if (last && last.color === cell.color && last.bold === cell.bold) last.text += cell.ch;
    else runs.push({ text: cell.ch, color: cell.color, bold: cell.bold });
  }
  return (
    <Text>
      {runs.map((run, index) => (
        // eslint-disable-next-line react/no-array-index-key -- runs are positional by construction
        <Text key={`r-${index}`} color={run.color} bold={run.bold}>
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

export function ErrorShell({
  message,
  scenario,
  waterfall,
  debugEnabled = false,
  debugError,
  onResolve,
  onRetry,
}: {
  message: string;
  scenario?: ErrorScenario;
  waterfall?: PlaybackFailureWaterfallModel | null;
  debugEnabled?: boolean;
  debugError?: unknown;
  onResolve: () => void;
  onRetry?: () => void;
}) {
  // Memoized on its inputs, not recomputed per render: it is a dependency of
  // the row model below, and a fresh object each render would defeat that memo.
  const debugExcerpt = React.useMemo(
    () => (debugEnabled ? extractErrorDebugExcerpt(debugError) : null),
    [debugEnabled, debugError],
  );

  useInput((input, key) => {
    if (key.return || key.escape) {
      onResolve();
      return;
    }
    if (input.toLowerCase() === "r" && onRetry) {
      onRetry();
    }
  });

  const rows = React.useMemo(
    () =>
      buildErrorRows({ message, scenario, waterfall, debugExcerpt, canRetry: Boolean(onRetry) }),
    [message, scenario, waterfall, debugExcerpt, onRetry],
  );

  // Width comes from the terminal alone — never from the petals, or the border
  // would move frame to frame.
  const { cols } = useShellDimensions();
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(cols - PANEL_CHROME, MAX_PANEL_WIDTH));

  const settled = settledFrame(rows.length);
  const tick = useFrameTick(true, PETAL_STEP_MS, settled);
  const frame = reducedMotionEnabled() ? settled : tick;

  const rowEndColumns = React.useMemo(
    () => rows.map((row) => TEXT_COLUMN + [...rowText(row)].length),
    [rows],
  );
  const petals = petalsForFrame({ frame, rowCount: rows.length, rowEndColumns, width });

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={palette.danger}
      paddingX={1}
      width={width + 4}
    >
      {rows.map((row, index) => (
        <ErrorRowLine
          // eslint-disable-next-line react/no-array-index-key -- rows are positional by construction
          key={`row-${index}`}
          row={row}
          petals={petals.filter((petal) => petal.row === index)}
          width={width}
        />
      ))}
    </Box>
  );
}
