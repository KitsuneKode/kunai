import type { PostPlayState } from "@/domain/playback/post-play-state";
import { Box, Text, useInput } from "ink";
import React from "react";

import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { PlaybackRecommendationRailItem } from "./types";

type PostPlayShellProps = {
  title: string;
  episodeLabel: string;
  nextEpisodeLabel?: string;
  postPlayState: PostPlayState;
  recommendations?: readonly PlaybackRecommendationRailItem[];
  totalEpisodes?: number;
  watchedEpisodes?: number;
  currentSeason?: number;
  onContinue?: () => void;
  onNextSeason?: () => void;
  onWatchlist?: () => void;
  onQuit?: () => void;
  onRecommendation?: (item: PlaybackRecommendationRailItem) => void;
};

export const PostPlayShell = React.memo(function PostPlayShell({
  title,
  episodeLabel,
  nextEpisodeLabel,
  postPlayState,
  recommendations = [],
  totalEpisodes,
  watchedEpisodes,
  currentSeason,
  onContinue,
  onNextSeason,
  onWatchlist,
  onQuit,
  onRecommendation,
}: PostPlayShellProps) {
  const [recIndex, setRecIndex] = React.useState(0);

  useInput((input, key) => {
    if (key.return || input === "c") {
      if (postPlayState.kind === "mid-series") onContinue?.();
      if (postPlayState.kind === "season-finale") onNextSeason?.();
    }
    if (input === "w") onWatchlist?.();
    if (input === "q" || key.escape) onQuit?.();
    if ((key.leftArrow || input === "h") && recIndex > 0) setRecIndex((i) => i - 1);
    if ((key.rightArrow || input === "l") && recIndex < recommendations.length - 1)
      setRecIndex((i) => i + 1);
    if (key.return && postPlayState.kind === "series-complete" && recommendations[recIndex]) {
      onRecommendation?.(recommendations[recIndex]);
    }
  });

  const progress =
    totalEpisodes && watchedEpisodes
      ? Math.round((watchedEpisodes / totalEpisodes) * 100)
      : undefined;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {/* Header context strip */}
      <Box marginBottom={1}>
        <Text color={palette.muted} dimColor>
          {title}
          {episodeLabel ? `  ·  ${episodeLabel}` : ""}
        </Text>
      </Box>

      {/* State-specific primary zone */}
      {postPlayState.kind === "mid-series" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.amber}>↵ continue</Text>
          {nextEpisodeLabel && (
            <Text color={palette.text} dimColor>
              {"   "}
              {truncateLine(nextEpisodeLabel, 60)}
            </Text>
          )}
        </Box>
      )}

      {postPlayState.kind === "caught-up" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.teal}>◉ caught up</Text>
          {postPlayState.nextAirDate && (
            <Text color={palette.muted}>
              {"   next episode "}
              {postPlayState.nextAirDate}
            </Text>
          )}
          <Box marginTop={1}>
            <Text color={palette.amber}>w </Text>
            <Text color={palette.dim}>add to watchlist to get notified</Text>
          </Box>
        </Box>
      )}

      {postPlayState.kind === "season-finale" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.green}>✦ Season {currentSeason} complete</Text>
          {postPlayState.hasNextSeason && (
            <Box marginTop={1}>
              <Text color={palette.amber}>↵ continue to next season</Text>
            </Box>
          )}
          {progress !== undefined && (
            <Box marginTop={1}>
              <Text color={palette.dim}>
                {watchedEpisodes} of {totalEpisodes} eps · {progress}%
              </Text>
            </Box>
          )}
        </Box>
      )}

      {postPlayState.kind === "series-complete" && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={palette.purple}>✦ you finished {title}</Text>
          {totalEpisodes && currentSeason && (
            <Text color={palette.dim}>
              {totalEpisodes} episodes across {currentSeason} seasons
            </Text>
          )}
        </Box>
      )}

      {/* Recommendations (secondary zone — always quiet) */}
      {recommendations.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.dim}>
            {postPlayState.kind === "series-complete"
              ? "because you finished this"
              : "you might also like"}
          </Text>
          <Box marginTop={1} flexDirection="row" flexWrap="nowrap">
            {recommendations.slice(0, 4).map((rec, i) => (
              <Box key={rec.id} marginRight={3}>
                <Text
                  color={
                    i === recIndex && postPlayState.kind === "series-complete"
                      ? palette.amber
                      : palette.text
                  }
                >
                  {truncateLine(rec.title, 20)}
                </Text>
              </Box>
            ))}
          </Box>
          {postPlayState.kind === "series-complete" && recommendations.length > 0 && (
            <Box marginTop={1}>
              <Text color={palette.dim}>{"← → browse  ·  ↵ play"}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Footer hint */}
      <Box marginTop={2}>
        <Text color={palette.dim} dimColor>
          {postPlayState.kind === "mid-series"
            ? "↵ continue  q quit  / commands"
            : postPlayState.kind === "caught-up"
              ? "w watchlist  q quit  / commands"
              : postPlayState.kind === "season-finale"
                ? "↵ continue  q quit  / commands"
                : "↵ play recommendation  q quit  / commands"}
        </Text>
      </Box>
    </Box>
  );
});
