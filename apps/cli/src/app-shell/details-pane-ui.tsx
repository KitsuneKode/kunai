import { Box, Text } from "ink";
import React from "react";

import type { DetailsPanelData, DetailsPanelSecondary } from "./details-panel";
import { PosterInitialBlock } from "./poster-initial-block";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

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

function FactRow({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = Math.min(14, Math.max(8, label.length + 1));
  return (
    <Box>
      <Text color={palette.dim}>{truncateLine(label, labelWidth).padEnd(labelWidth)}</Text>
      <Text color={palette.text}>{truncateLine(value, width - labelWidth - 2)}</Text>
    </Box>
  );
}

export function DetailsPaneUI({
  data,
  width = 36,
  posterRows = 10,
  posterCols = 22,
}: {
  data: DetailsPanelData;
  width?: number;
  posterRows?: number;
  posterCols?: number;
}) {
  const { primary, secondary } = data;
  const { poster, posterState } = usePosterPreview(primary.posterPath ?? undefined, {
    rows: posterRows,
    cols: posterCols,
    enabled: Boolean(primary.posterPath),
    debounceMs: 90,
    variant: "detail",
  });
  const seriesState = secondary?.seriesState ?? null;
  const seriesStateColor = seriesState ? SERIES_STATE_COLORS[seriesState] : palette.dim;

  return (
    <Box flexDirection="row" width={width}>
      <Box width={1} marginRight={1}>
        <Text color={seriesStateColor}>{"│"}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          {poster.kind !== "none" ? (
            <Text>{poster.placeholder}</Text>
          ) : primary.posterPath ? (
            <Text color={posterState === "loading" ? palette.info : palette.dim} dimColor>
              {posterState === "loading" ? "Loading poster…" : "[poster]"}
            </Text>
          ) : (
            <PosterInitialBlock title={primary.title} width={8} height={4} />
          )}
        </Box>
        <Text bold>{truncateLine(primary.title, width - 4)}</Text>
        <Text color={palette.dim}>
          {[primary.type, primary.year, ...(primary.genres?.slice(0, 2) ?? [])]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {primary.synopsis && (
          <Box marginTop={1}>
            <Text color={palette.dim}>{truncateLine(primary.synopsis, (width - 4) * 3)}</Text>
          </Box>
        )}

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
            {secondary.seasonLabel || secondary.totalEpisodes !== undefined ? (
              <FactRow
                label="Season"
                value={
                  [
                    secondary.seasonLabel,
                    secondary.totalEpisodes !== undefined
                      ? `${secondary.totalEpisodes} eps`
                      : undefined,
                    secondary.watchedEpisodes !== undefined
                      ? `${secondary.watchedEpisodes} watched`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                }
                width={width - 4}
              />
            ) : null}
            {secondary.providers && secondary.providers.length > 0 ? (
              <FactRow label="Provider" value={secondary.providers.join(" · ")} width={width - 4} />
            ) : null}
            {secondary.subtitleLanguages && secondary.subtitleLanguages.length > 0 ? (
              <FactRow
                label="Sub"
                value={secondary.subtitleLanguages.join(" · ")}
                width={width - 4}
              />
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  );
}
