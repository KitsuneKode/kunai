import type { PostPlayState } from "@/domain/playback/post-play-state";
import { Box, Text } from "ink";
import React from "react";

import { ContextCard } from "./primitives/ContextCard";
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
  const progress =
    totalEpisodes && watchedEpisodes !== undefined && totalEpisodes > 0
      ? Math.round((watchedEpisodes / totalEpisodes) * 100)
      : undefined;

  const viewport = useViewportPolicy("playback");
  const showRecommendations =
    recommendations.length > 0 && viewport.breakpoint !== "narrow" && !viewport.ultraCompact;
  const recHeading =
    postPlayState.kind === "series-complete" ? "because you finished this" : "you might also like";
  const isMovie = episodeLabel === "Movie";
  const didNotStart = postPlayState.kind === "did-not-start";
  const progressBarWidth = Math.min(40, Math.max(16, viewport.columns - 24));
  const seriesProgressBar =
    progress !== undefined
      ? (() => {
          const filled = Math.floor((progress / 100) * progressBarWidth);
          return `${"█".repeat(filled)}${"░".repeat(Math.max(0, progressBarWidth - filled))}`;
        })()
      : null;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Title + episode context live in the ShellFrame header; the body is the
          "what next" remote, so it leads with the outcome state, not a 2nd title. */}
      {didNotStart ? (
        <Text color={palette.accentDeep}>▢ playback didn’t start</Text>
      ) : resumeLabel ? (
        <Text color={palette.accentDeep}>⏸ stopped early</Text>
      ) : isMovie ? (
        <Text color={palette.ok}>✓ movie complete</Text>
      ) : (
        <Text color={palette.ok}>✓ episode complete</Text>
      )}

      {didNotStart ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.textDim}>nothing was recorded for this title.</Text>
          <Box marginTop={1}>
            <Text color={palette.dim}>↵ try again · / search for another title</Text>
          </Box>
        </Box>
      ) : null}

      {!didNotStart && resumeLabel ? (
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color={palette.accent}>{"▌ "}</Text>
            <Text color={palette.accent}>↵ resume</Text>
          </Text>
          <Text color={palette.textDim}>{`  ${truncateLine(resumeLabel, 64)}`}</Text>
        </Box>
      ) : null}

      {!didNotStart && isMovie && !resumeLabel ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.dim}>↵ replay · / search for another title</Text>
        </Box>
      ) : null}

      {!resumeLabel && !isMovie && postPlayState.kind === "mid-series" && (
        <Box marginTop={1} flexDirection="column">
          <ContextCard
            selected
            width={Math.min(42, Math.max(28, viewport.columns - 20))}
            model={{
              kind: "next",
              title: nextEpisodeLabel ?? "Next episode",
              subtitle: "up next",
              thumbnailState: "none",
              stateLabel: "playable",
              stateTone: "success",
            }}
          />
        </Box>
      )}

      {postPlayState.kind === "caught-up" && (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.ok}>◉ caught up</Text>
          {postPlayState.nextAirDate ? (
            <Text color={palette.muted}>
              {"next episode "}
              {postPlayState.nextAirDate}
            </Text>
          ) : null}
          <Box marginTop={1}>
            <Text color={palette.dim}>w watchlist · /calendar for releases</Text>
          </Box>
        </Box>
      )}

      {postPlayState.kind === "season-finale" && (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.ok}>✦ Season {currentSeason ?? "?"} complete</Text>
          {postPlayState.hasNextSeason ? (
            <Box marginTop={1}>
              <Text color={palette.accent}>↵ continue to next season</Text>
            </Box>
          ) : null}
          {progress !== undefined && totalEpisodes && watchedEpisodes !== undefined ? (
            <Box marginTop={1} flexDirection="column">
              <Text color={palette.dim}>
                {seriesProgressBar} {watchedEpisodes} of {totalEpisodes} eps overall · {progress}%
              </Text>
            </Box>
          ) : null}
        </Box>
      )}

      {postPlayState.kind === "series-complete" && (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.milestone}>✦ you finished {truncateLine(title, 48)}</Text>
          {totalEpisodes && currentSeason ? (
            <Text color={palette.dim}>
              {totalEpisodes} episodes across {currentSeason} season
              {currentSeason === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      )}

      {showRecommendations && !didNotStart ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.dim}>{recHeading}</Text>
          {postPlayState.kind === "series-complete" ? (
            <Text color={palette.muted}>
              {recommendations
                .slice(0, 3)
                .map((rec) => truncateLine(rec.title, 28))
                .join("  ·  ")}
            </Text>
          ) : (
            recommendations.slice(0, 3).map((rec, index) => (
              <Box key={rec.id} marginTop={index === 0 ? 1 : 0}>
                <Text color={palette.dim}>{`${index + 1}. `}</Text>
                <Text>
                  {truncateLine(rec.title, 42)}
                  {rec.year ? <Text color={palette.dim}>{` (${rec.year})`}</Text> : null}
                </Text>
              </Box>
            ))
          )}
        </Box>
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
