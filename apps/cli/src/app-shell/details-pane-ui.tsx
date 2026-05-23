import { Box, Text } from "ink";
import React from "react";

import type { DetailsPanelData, DetailsPanelSecondary } from "./details-panel";
import { PosterInitialBlock } from "./poster-initial-block";
import { truncateAtWord, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import type { ShellPanelLine } from "./types";
import { usePosterPreview } from "./use-poster-preview";

type SeriesStateKey = NonNullable<DetailsPanelSecondary["seriesState"]>;

const SERIES_STATE_COLORS: Record<SeriesStateKey, string> = {
  airing: palette.muted,
  ended: palette.ok,
  complete: palette.milestone,
  upcoming: palette.muted,
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

const DETAIL_FACT_LABEL_WIDTH = 10;

function FactRow({ label, value, width }: { label: string; value: string; width: number }) {
  const labelWidth = Math.min(DETAIL_FACT_LABEL_WIDTH, Math.max(6, label.length + 1));
  return (
    <Box>
      <Text color={palette.dim}>{truncateLine(label, labelWidth).padEnd(labelWidth)}</Text>
      <Text color={palette.text}>{truncateLine(value, width - labelWidth - 2)}</Text>
    </Box>
  );
}

function sheetLineColor(tone: ShellPanelLine["tone"]): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "error") return palette.danger;
  if (tone === "info") return palette.muted;
  return palette.text;
}

export function DetailsSheetUI({
  data,
  lines,
  width = 48,
  scrollIndex = 0,
  maxVisibleLines = 12,
}: {
  readonly data: DetailsPanelData;
  readonly lines: readonly ShellPanelLine[];
  readonly width?: number;
  readonly scrollIndex?: number;
  readonly maxVisibleLines?: number;
}) {
  const { primary } = data;
  const headerLines = [
    primary.title,
    [primary.type, primary.year, ...(primary.genres?.slice(0, 3) ?? [])]
      .filter(Boolean)
      .join(" · "),
    primary.synopsis ? truncateAtWord(primary.synopsis, width * 2) : undefined,
  ].filter((line): line is string => Boolean(line));
  const bodyStart = headerLines.length;
  const scrollable = lines.slice(bodyStart);
  const maxScroll = Math.max(0, scrollable.length - maxVisibleLines);
  const clampedScroll = Math.min(scrollIndex, maxScroll);
  const visible = scrollable.slice(clampedScroll, clampedScroll + maxVisibleLines);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={palette.line}
      paddingX={1}
    >
      <Text color={palette.text} bold>
        {truncateLine(primary.title, width - 2)}
      </Text>
      <Text color={palette.muted}>
        {[primary.type, primary.year, ...(primary.genres?.slice(0, 3) ?? [])]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {primary.synopsis ? (
        <Box marginTop={1}>
          <Text color={palette.dim}>{truncateAtWord(primary.synopsis, width * 2)}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        {visible.map((line) =>
          line.detail === "" && line.label.startsWith("───") ? (
            <Text key={line.label} color={palette.muted}>
              {line.label}
            </Text>
          ) : (
            <Box key={`${line.label}:${line.detail ?? ""}`}>
              <Text color={palette.dim}>
                {truncateLine(line.label, DETAIL_FACT_LABEL_WIDTH).padEnd(DETAIL_FACT_LABEL_WIDTH)}
              </Text>
              <Text color={sheetLineColor(line.tone)}>
                {truncateLine(line.detail ?? "", width - DETAIL_FACT_LABEL_WIDTH - 2)}
              </Text>
            </Box>
          ),
        )}
      </Box>
      {scrollable.length > maxVisibleLines ? (
        <Text color={palette.dim} dimColor>
          {clampedScroll > 0 ? "▲ " : ""}
          {clampedScroll < maxScroll ? "▼ scroll" : ""}
        </Text>
      ) : null}
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
            <Text color={posterState === "loading" ? palette.muted : palette.dim} dimColor>
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
        <Box marginTop={1}>
          {primary.synopsis ? (
            <Text color={palette.dim}>{truncateAtWord(primary.synopsis, (width - 4) * 3)}</Text>
          ) : (
            <Text color={palette.dim} dimColor>
              No synopsis available
            </Text>
          )}
        </Box>

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
