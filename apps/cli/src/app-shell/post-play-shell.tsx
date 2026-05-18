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
  const progressBarWidth = Math.min(40, Math.max(16, viewport.columns - 24));
  const seriesProgressBar =
    progress !== undefined
      ? (() => {
          const filled = Math.floor((progress / 100) * progressBarWidth);
          return `${"█".repeat(filled)}${"░".repeat(Math.max(0, progressBarWidth - filled))}`;
        })()
      : null;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {resumeLabel ? (
        <Text color={palette.amber}>⏸ stopped early</Text>
      ) : isMovie ? (
        <Text color={palette.green}>✓ movie complete</Text>
      ) : (
        <Text color={palette.green}>✓ episode complete</Text>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>{truncateLine(title, 72)}</Text>
        {episodeLabel ? (
          <Text color={palette.dim} dimColor>
            {episodeLabel}
          </Text>
        ) : null}
      </Box>

      {resumeLabel ? (
        <Box
          marginTop={2}
          flexDirection="column"
          borderStyle="round"
          borderColor={palette.amber}
          paddingX={1}
          paddingY={0}
        >
          <Text color={palette.amber}>↵ resume</Text>
          <Text color={palette.textDim}>{truncateLine(resumeLabel, 64)}</Text>
        </Box>
      ) : null}

      {isMovie && !resumeLabel ? (
        <Box marginTop={2} flexDirection="column">
          <Text color={palette.dim}>↵ replay · / search for another title</Text>
        </Box>
      ) : null}

      {!resumeLabel && !isMovie && postPlayState.kind === "mid-series" && (
        <Box
          marginTop={2}
          flexDirection="column"
          borderStyle="round"
          borderColor={palette.amber}
          paddingX={1}
          paddingY={0}
        >
          <Text color={palette.amber}>▶ up next</Text>
          {nextEpisodeLabel ? (
            <Text>{truncateLine(nextEpisodeLabel, 64)}</Text>
          ) : (
            <Text color={palette.dim}>Next episode</Text>
          )}
        </Box>
      )}

      {postPlayState.kind === "caught-up" && (
        <Box marginTop={2} flexDirection="column">
          <Text color={palette.teal}>◉ caught up</Text>
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
        <Box marginTop={2} flexDirection="column">
          <Text color={palette.green}>✦ Season {currentSeason ?? "?"} complete</Text>
          {postPlayState.hasNextSeason ? (
            <Box marginTop={1}>
              <Text color={palette.amber}>↵ continue to next season</Text>
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
        <Box marginTop={2} flexDirection="column">
          <Text color={palette.purple}>✦ you finished {truncateLine(title, 48)}</Text>
          {totalEpisodes && currentSeason ? (
            <Text color={palette.dim}>
              {totalEpisodes} episodes across {currentSeason} season
              {currentSeason === 1 ? "" : "s"}
            </Text>
          ) : null}
        </Box>
      )}

      {showRecommendations ? (
        <Box marginTop={2} flexDirection="column">
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
        <Text color={palette.dim} dimColor>
          widen terminal for recommendations
        </Text>
      ) : null}
    </Box>
  );
});
