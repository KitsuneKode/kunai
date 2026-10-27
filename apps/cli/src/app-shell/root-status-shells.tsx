import { resolveContentKind, showsEpisodeLabel } from "@/domain/media/content-kind";
import type { ErrorScenario } from "@/domain/playback/playback-problem";
import type { SessionState } from "@/domain/session/SessionState";
import { measureColumns, truncateLine } from "@/domain/text-display";
import { Box, Text, useInput } from "ink";
import React from "react";

import { extractErrorDebugExcerpt } from "./error-debug-excerpt";
import { MouseTarget } from "./mouse/MouseRegions";
import { buildErrorRows, type ErrorRow, type ErrorRowTone } from "./playback-error-rows";
import type { PlaybackFailureWaterfallModel } from "./playback-failure-waterfall";
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
          label={query.length > 0 ? `Searching ${truncateLine(query, 60)}…` : "Searching…"}
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
    // SAFETY: provider names are unbounded — blank falls back, long truncates.
    const titleName = currentTitle.name?.trim()
      ? truncateLine(currentTitle.name.trim(), 60)
      : "Unknown title";
    return (
      <Box flexDirection="column" flexGrow={1}>
        <SakuraLoader
          label={`Preparing ${titleName}…`}
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
          <Text color={palette.dim}>{resolveContentKind(currentTitle, state.mode)}</Text>
          <Box marginTop={1}>
            <Text color={palette.accent}>{"⏸  "}</Text>
            <Text color={palette.text} bold>
              {currentTitle?.name?.trim()
                ? truncateLine(currentTitle.name.trim(), 60)
                : "Current session"}
            </Text>
            {currentEpisode ? <Text color={palette.muted}>{`  ${currentEpisode}`}</Text> : null}
          </Box>
          <Box marginTop={1}>
            <Text color={palette.dim}>
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
              {
                "search for a title to begin  ·  /guide for the tour  ·  /discover for recommendations"
              }
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

function toneColor(tone: ErrorRowTone): string {
  switch (tone) {
    case "danger-strong":
    case "danger":
      return palette.dangerText;
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

/** Failure text is static: recovery actions own feedback, not decorations. */
function ErrorRowLine({ row, width }: { readonly row: ErrorRow; readonly width: number }) {
  let remaining = width - TEXT_COLUMN;
  return (
    <Text>
      <Text color={palette.dangerDim}>│ </Text>
      {row.segments.map((segment, index) => {
        const text = truncateLine(segment.text, Math.max(0, remaining));
        remaining -= measureColumns(text);
        return (
          // eslint-disable-next-line react/no-array-index-key -- error segments are positional
          <Text key={index} color={toneColor(segment.tone)} bold={segment.tone === "danger-strong"}>
            {text}
          </Text>
        );
      })}
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
  onProviders,
}: {
  message: string;
  scenario?: ErrorScenario;
  waterfall?: PlaybackFailureWaterfallModel | null;
  debugEnabled?: boolean;
  debugError?: unknown;
  onResolve: () => void;
  onRetry?: () => void;
  onProviders?: () => void;
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
    if (input.toLowerCase() === "r" && onRetry) onRetry();
    if (input.toLowerCase() === "p" && onProviders) onProviders();
  });

  // Width comes from the terminal alone — never from the petals, or the border
  // would move frame to frame. Computed before the rows so the free-text
  // message wraps to it instead of being clipped mid-word at the panel edge.
  const { cols } = useShellDimensions();
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(cols - PANEL_CHROME, MAX_PANEL_WIDTH));

  const rows = React.useMemo(
    () =>
      buildErrorRows({
        message,
        scenario,
        waterfall,
        debugExcerpt,
        canRetry: Boolean(onRetry),
        textWidth: width - TEXT_COLUMN,
      }),
    [message, scenario, waterfall, debugExcerpt, onRetry, width],
  );

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
          width={width}
        />
      ))}
      {onProviders ? (
        <MouseTarget id="playback-error:providers" onClick={onProviders}>
          <Text color={palette.accent} bold>
            [p] providers
          </Text>
        </MouseTarget>
      ) : null}
    </Box>
  );
}
