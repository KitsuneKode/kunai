import { Box, Text } from "ink";
import React from "react";

import type { PlaybackPlayingRailView } from "./playback-playing-view";
import type { PostPlayRailFact, PostPlayUpNextCard } from "./post-play-view";
import { padColumnsEnd, truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

function initialsOf(title: string): string {
  return (
    title
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .slice(0, 3)
      .join("") || "?"
  );
}

function RailLabel({ label }: { readonly label: string }) {
  return (
    <Box marginTop={1}>
      <Text color={palette.muted} bold>
        {label.toUpperCase()}
      </Text>
    </Box>
  );
}

function RailFacts({
  facts,
  width,
}: {
  readonly facts: readonly PostPlayRailFact[];
  readonly width: number;
}) {
  if (facts.length === 0) return null;
  const labelWidth = 10;
  const valueWidth = Math.max(8, width - labelWidth - 2);
  return (
    <Box flexDirection="column" marginTop={1}>
      {facts.map((fact) => (
        <Box key={`${fact.label}:${fact.value}`} flexDirection="row" flexWrap="nowrap">
          <Text color={palette.muted}>
            {padColumnsEnd(truncateLine(fact.label, labelWidth), labelWidth)}{" "}
          </Text>
          <Text color={fact.tone === "success" ? palette.ok : palette.textDim}>
            {truncateLine(fact.value, valueWidth)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function SeriesPosterSlot({
  url,
  title,
  width,
}: {
  readonly url?: string;
  readonly title: string;
  readonly width: number;
}) {
  const innerCols = Math.max(10, width - 2);
  const { poster, posterState } = usePosterPreview(url, {
    rows: 14,
    cols: innerCols,
    enabled: Boolean(url),
    variant: "detail",
    debounceMs: 120,
  });

  return (
    <Box width={width} minHeight={16} justifyContent="center" alignItems="center">
      {poster.kind !== "none" ? (
        <Text>{poster.placeholder}</Text>
      ) : (
        <Text color={palette.dim} bold>
          {posterState === "loading" ? "…" : initialsOf(title)}
        </Text>
      )}
    </Box>
  );
}

function UpNextThumbSlot({
  url,
  title,
  width,
}: {
  readonly url?: string;
  readonly title: string;
  readonly width: number;
}) {
  const innerCols = Math.max(8, width - 2);
  const { poster, posterState } = usePosterPreview(url, {
    rows: 4,
    cols: innerCols,
    enabled: Boolean(url),
    variant: "preview",
    inkEmbedded: true,
    preserveTerminalImages: true,
    debounceMs: 160,
  });

  return (
    <Box width={width} minHeight={5} justifyContent="center" alignItems="center" marginTop={1}>
      {poster.kind !== "none" ? (
        <Text>{poster.placeholder}</Text>
      ) : url ? (
        <Text color={palette.dim}>{posterState === "loading" ? "…" : "preview"}</Text>
      ) : (
        <Text color={palette.dim}>{initialsOf(title)}</Text>
      )}
    </Box>
  );
}

function UpNextCard({
  card,
  width,
}: {
  readonly card: PostPlayUpNextCard;
  readonly width: number;
}) {
  const textWidth = Math.max(8, width - 2);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box
        borderStyle="single"
        borderColor={palette.lineSoft}
        paddingX={1}
        flexDirection="column"
        width={width}
      >
        <Text color={palette.text} bold>
          {truncateLine(card.label, textWidth)}
        </Text>
        <Text color={palette.muted}>{truncateLine(card.meta, textWidth)}</Text>
      </Box>
    </Box>
  );
}

export const PlaybackPlayingRail = React.memo(function PlaybackPlayingRail({
  title,
  railWidth,
  view,
  nextEpisodeThumbUrl,
}: {
  readonly title: string;
  readonly railWidth: number;
  readonly view: PlaybackPlayingRailView;
  readonly nextEpisodeThumbUrl?: string;
}) {
  const innerWidth = Math.max(12, railWidth - 3);

  return (
    <Box
      flexDirection="column"
      width={railWidth}
      paddingLeft={2}
      borderStyle="single"
      borderColor={palette.lineSoft}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
    >
      <SeriesPosterSlot url={view.seriesPosterUrl} title={title} width={innerWidth} />

      {view.facts.length > 0 ? (
        <>
          <RailLabel label="Series" />
          <RailFacts facts={view.facts} width={innerWidth} />
        </>
      ) : null}

      {view.synopsis ? (
        <Box marginTop={1}>
          <Text color={palette.textDim}>{truncateLine(view.synopsis, innerWidth)}</Text>
        </Box>
      ) : null}

      {view.upNext ? (
        <>
          <RailLabel label="Up next" />
          <UpNextThumbSlot url={nextEpisodeThumbUrl} title={view.upNext.label} width={innerWidth} />
          <UpNextCard card={view.upNext} width={innerWidth} />
        </>
      ) : null}
    </Box>
  );
});
