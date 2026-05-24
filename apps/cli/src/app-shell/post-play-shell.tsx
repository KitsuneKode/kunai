import type { PostPlayState } from "@/domain/playback/post-play-state";
import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { PlaybackRecommendationRailItem } from "./types";
import { useViewportPolicy } from "./use-viewport-policy";

export type PostPlayShellProps = {
  title: string;
  episodeLabel: string;
  nextEpisodeLabel?: string;
  resumeLabel?: string;
  postPlayState: PostPlayState;
  recommendations?: readonly PlaybackRecommendationRailItem[];
  totalEpisodes?: number;
  watchedEpisodes?: number;
  currentSeason?: number;
};

// Thin labelled divider used between the action hero and the discovery picks,
// matching the prototype's "──── optional discovery ────" separators.
function Divider({ label, width }: { label?: string; width: number }) {
  if (!label) {
    return <Text color={palette.lineSoft}>{"─".repeat(Math.max(4, width))}</Text>;
  }
  const side = Math.max(2, Math.floor((width - label.length - 2) / 2));
  return (
    <Text color={palette.lineSoft}>
      {"─".repeat(side)}
      <Text color={palette.dim}>{` ${label} `}</Text>
      {"─".repeat(Math.max(2, width - side - label.length - 2))}
    </Text>
  );
}

// Numbered, inline picks ("1 Title · 2 Title · 3 Title") — the prototype's
// actionable discovery row (1–3 select). Kept compact so it never dominates the
// action hero above it.
function NumberedPicks({
  items,
  width,
  highlightHeading,
}: {
  items: readonly PlaybackRecommendationRailItem[];
  width: number;
  highlightHeading: string;
}) {
  if (items.length === 0) return null;
  const picks = items.slice(0, 3);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Divider label={highlightHeading} width={width} />
      <Box marginTop={1} flexDirection="column">
        {picks.map((rec, index) => (
          <Box key={rec.id} flexDirection="row">
            <Text color={palette.accent} bold>{`${index + 1} `}</Text>
            <Text color={palette.text}>{truncateLine(rec.title, width - 8)}</Text>
            {rec.year ? <Text color={palette.dim}>{` (${rec.year})`}</Text> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export const PostPlayShell = React.memo(function PostPlayShell({
  title,
  episodeLabel,
  nextEpisodeLabel,
  resumeLabel,
  postPlayState,
  recommendations = [],
  totalEpisodes,
  watchedEpisodes,
  currentSeason,
}: PostPlayShellProps) {
  const viewport = useViewportPolicy("playback");
  const bodyWidth = Math.min(56, Math.max(28, viewport.columns - 24));
  const progress =
    totalEpisodes && watchedEpisodes !== undefined && totalEpisodes > 0
      ? Math.round((watchedEpisodes / totalEpisodes) * 100)
      : undefined;
  const seriesProgressBar =
    progress !== undefined
      ? (() => {
          const filled = Math.floor((progress / 100) * bodyWidth);
          return `${"█".repeat(filled)}${"░".repeat(Math.max(0, bodyWidth - filled))}`;
        })()
      : null;

  const showRecommendations =
    recommendations.length > 0 && viewport.breakpoint !== "narrow" && !viewport.ultraCompact;
  const isMovie = episodeLabel === "Movie";
  const didNotStart = postPlayState.kind === "did-not-start";

  // ── playback didn't start ──────────────────────────────────────────────
  if (didNotStart) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={palette.accentDeep} bold>
          ▢ playback didn’t start
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.textDim}>nothing was recorded for this title.</Text>
          <Box marginTop={1}>
            <Text color={palette.dim}>↵ try again · s search for another title</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* ── Resume hero (stopped early) ──────────────────────────────────── */}
      {resumeLabel ? (
        <Box flexDirection="column">
          <Text color={palette.accentDeep} bold>
            ⏸ stopped early
          </Text>
          {seriesProgressBar ? (
            <Box marginTop={1}>
              <Text color={palette.accentDeep}>{seriesProgressBar}</Text>
              <Text color={palette.dim}>{`  ${progress}% of season`}</Text>
            </Box>
          ) : null}
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color={palette.accent}>{"▌ "}</Text>
              <Text color={palette.accent} bold>
                ↵ resume
              </Text>
              <Text color={palette.dim}>{"  same stream · same position"}</Text>
            </Text>
            <Text color={palette.textDim}>{`  ${truncateLine(resumeLabel, bodyWidth)}`}</Text>
          </Box>
        </Box>
      ) : null}

      {/* ── Movie complete ───────────────────────────────────────────────── */}
      {!resumeLabel && isMovie ? (
        <Box flexDirection="column">
          <Text color={palette.ok} bold>
            ✓ movie complete
          </Text>
          <Box marginTop={1}>
            <Text color={palette.dim}>↵ replay · / search for another title</Text>
          </Box>
        </Box>
      ) : null}

      {/* ── Mid-series: NEXT hero ────────────────────────────────────────── */}
      {!resumeLabel && !isMovie && postPlayState.kind === "mid-series" ? (
        <Box flexDirection="column">
          <Text color={palette.ok}>✓ episode complete</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>
              <Text color={palette.dim}>{"NEXT  "}</Text>
              <Text color={palette.accent} bold>
                {truncateLine(nextEpisodeLabel ?? "Next episode", bodyWidth - 6)}
              </Text>
            </Text>
            <Text color={palette.textDim}>↵ continue · n next · r replay</Text>
          </Box>
        </Box>
      ) : null}

      {/* ── Caught up ────────────────────────────────────────────────────── */}
      {postPlayState.kind === "caught-up" ? (
        <Box flexDirection="column">
          <Text color={palette.ok} bold>
            ◉ caught up
          </Text>
          {postPlayState.nextAirDate ? (
            <Text color={palette.muted}>{`next broadcast · ${postPlayState.nextAirDate}`}</Text>
          ) : null}
          <Box marginTop={1}>
            <Text color={palette.dim}>w watchlist · /calendar for releases</Text>
          </Box>
        </Box>
      ) : null}

      {/* ── Season finale ────────────────────────────────────────────────── */}
      {postPlayState.kind === "season-finale" ? (
        <Box flexDirection="column">
          <Text color={palette.ok} bold>
            ✦ Season {currentSeason ?? "?"} complete
          </Text>
          {postPlayState.hasNextSeason ? (
            <Box marginTop={1}>
              <Text color={palette.accent} bold>
                ↵ continue to next season
              </Text>
            </Box>
          ) : null}
          {seriesProgressBar && totalEpisodes && watchedEpisodes !== undefined ? (
            <Box marginTop={1} flexDirection="column">
              <Text color={palette.accentDeep}>{seriesProgressBar}</Text>
              <Text color={palette.dim}>
                {watchedEpisodes} of {totalEpisodes} eps overall · {progress}%
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {/* ── Series complete (milestone) ──────────────────────────────────── */}
      {postPlayState.kind === "series-complete" ? (
        <Box flexDirection="column">
          <Text color={palette.milestone} bold>
            ✦ SERIES COMPLETE
          </Text>
          <Text color={palette.text}>{truncateLine(title, bodyWidth)}</Text>
          {totalEpisodes && currentSeason ? (
            <Text color={palette.dim}>
              {totalEpisodes} episodes · {currentSeason} season{currentSeason === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {/* ── Discovery picks ──────────────────────────────────────────────── */}
      {showRecommendations ? (
        <NumberedPicks
          items={recommendations}
          width={bodyWidth}
          highlightHeading={
            postPlayState.kind === "series-complete"
              ? "because you finished this"
              : "you might also like"
          }
        />
      ) : viewport.breakpoint === "narrow" && recommendations.length > 0 ? (
        <Box marginTop={1}>
          <Text color={palette.dim} dimColor>
            widen terminal for recommendations
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
