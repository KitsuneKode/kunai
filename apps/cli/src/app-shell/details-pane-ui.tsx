import { Box, Text } from "ink";
import React from "react";

import type { DetailsPanelData, DetailsPanelSecondary } from "./details-panel";
import { PosterInitialBlock } from "./poster-initial-block";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";

type SeriesStateKey = NonNullable<DetailsPanelSecondary["seriesState"]>;

const SERIES_STATE_COLORS: Record<SeriesStateKey, string> = {
  airing: palette.teal,
  ended: palette.green,
  complete: palette.purple,
  upcoming: palette.amber,
};

const SERIES_STATE_LABELS: Record<SeriesStateKey, string> = {
  airing: "◉ airing",
  ended: "✦ ended",
  complete: "✦ you finished this",
  upcoming: "upcoming",
};

function SecondaryZoneShimmer() {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>{"░".repeat(28)}</Text>
      <Text dimColor>{"░".repeat(20)}</Text>
      <Text dimColor>{"░".repeat(24)}</Text>
    </Box>
  );
}

export function DetailsPaneUI({ data, width = 36 }: { data: DetailsPanelData; width?: number }) {
  const { primary, secondary } = data;

  return (
    <Box flexDirection="column" width={width}>
      {/* Zone 1: Primary — instant */}
      <Box marginBottom={1}>
        {primary.posterPath ? (
          <Text color={palette.dim}>[poster]</Text>
        ) : (
          <PosterInitialBlock title={primary.title} width={8} height={4} />
        )}
      </Box>
      <Text bold>{truncateLine(primary.title, width - 2)}</Text>
      <Text color={palette.dim}>
        {[primary.type, primary.year, ...(primary.genres?.slice(0, 2) ?? [])]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {primary.synopsis && (
        <Box marginTop={1}>
          <Text color={palette.dim}>{truncateLine(primary.synopsis, (width - 2) * 3)}</Text>
        </Box>
      )}

      {/* Zone 2: Secondary — lazy */}
      {secondary === null ? (
        <SecondaryZoneShimmer />
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {secondary.seriesState && (
            <Text color={SERIES_STATE_COLORS[secondary.seriesState]}>
              {SERIES_STATE_LABELS[secondary.seriesState]}
              {secondary.nextAirDate ? `  ·  ${secondary.nextAirDate}` : ""}
            </Text>
          )}
          {secondary.watchedEpisodes !== undefined && secondary.totalEpisodes !== undefined && (
            <Text color={palette.dim}>
              {secondary.watchedEpisodes} of {secondary.totalEpisodes} eps
            </Text>
          )}
          {secondary.providers && secondary.providers.length > 0 && (
            <Text color={palette.dim}>{secondary.providers.join("  ·  ")}</Text>
          )}
          {secondary.subtitleLanguages && secondary.subtitleLanguages.length > 0 && (
            <Text color={palette.dim}>
              {"sub  "}
              {secondary.subtitleLanguages.join("  ·  ")}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
