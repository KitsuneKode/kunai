import { Box, Text } from "ink";
import React from "react";

import type { DetailsSheetModel } from "./details-sheet.model";
import { wrapSynopsis } from "./details-view";
import { PosterInitialBlock } from "./poster-initial-block";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

const POSTER_ROWS = 8;
const POSTER_COLS = 16;

function SheetPoster({ url, title }: { readonly url?: string; readonly title: string }) {
  const { poster } = usePosterPreview(url, {
    rows: POSTER_ROWS,
    cols: POSTER_COLS,
    enabled: Boolean(url),
    debounceMs: 90,
    variant: "detail",
    placementSlot: "details-sheet",
  });
  if (poster.kind !== "none") {
    return (
      <Box minHeight={POSTER_ROWS}>
        <Text>{poster.placeholder}</Text>
      </Box>
    );
  }
  return (
    <Box minHeight={POSTER_ROWS}>
      <PosterInitialBlock title={title} width={POSTER_COLS} height={POSTER_ROWS} />
    </Box>
  );
}

function Skeleton({ width }: { readonly width: number }) {
  return (
    <Text color={palette.muted} dimColor>
      {"░".repeat(Math.max(4, width))}
    </Text>
  );
}

function SectionLabel({ children }: { readonly children: string }) {
  return (
    <Text color={palette.accent} bold>
      {children}
    </Text>
  );
}

export function DetailsSheet({
  model,
  seasonsExpanded,
  width,
}: {
  readonly model: DetailsSheetModel;
  readonly seasonsExpanded: boolean;
  readonly width: number;
}) {
  const textWidth = Math.max(20, width - POSTER_COLS - 4);
  const synopsisLines = wrapSynopsis(model.synopsis.text, Math.max(20, width - 2), 6);

  return (
    <Box flexDirection="column" width={width}>
      {/* Header: poster + title/meta/genres */}
      <Box flexDirection="row">
        <Box width={POSTER_COLS} marginRight={2}>
          <SheetPoster url={model.header.posterUrl} title={model.header.title} />
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>{model.header.title}</Text>
          <Text color={palette.muted}>{model.header.metaLine}</Text>
          {model.header.genres.length > 0 ? (
            <Text color={palette.dim}>{model.header.genres.join(" · ")}</Text>
          ) : null}
          {model.your.progressLabel ? (
            <Text color={palette.ok}>Your progress · {model.your.progressLabel}</Text>
          ) : null}
        </Box>
      </Box>

      {/* Synopsis */}
      <Box flexDirection="column" marginTop={1}>
        <SectionLabel>Synopsis</SectionLabel>
        {model.synopsis.loading ? (
          <Skeleton width={Math.min(48, textWidth)} />
        ) : synopsisLines.length > 0 ? (
          synopsisLines.map((line) => (
            <Text key={line} color={palette.text}>
              {line}
            </Text>
          ))
        ) : (
          <Text color={palette.dim}>No synopsis available.</Text>
        )}
      </Box>

      {/* Facts */}
      <Box flexDirection="column" marginTop={1}>
        {model.facts.loading ? (
          <Skeleton width={24} />
        ) : (
          <Text color={palette.muted}>
            {[
              model.facts.studio ? `Studio: ${model.facts.studio}` : null,
              model.facts.episodes,
              model.facts.runtime,
              model.facts.contentRating,
            ]
              .filter(Boolean)
              .join("   ") || "—"}
          </Text>
        )}
      </Box>

      {/* Where to watch */}
      {model.your.providers.length > 0 || model.your.offline ? (
        <Text color={palette.muted}>
          Where: {model.your.providers.join(" · ")}
          {model.your.offline ? " · ⬇ offline" : ""}
          {model.your.subs.length > 0 ? `   Subs: ${model.your.subs.join(" · ")}` : ""}
        </Text>
      ) : null}

      {/* Cast */}
      <Box flexDirection="column" marginTop={1}>
        <SectionLabel>Cast</SectionLabel>
        {model.cast.loading ? (
          <Skeleton width={32} />
        ) : model.cast.names.length > 0 ? (
          <Text color={palette.text}>{model.cast.names.join(" · ")}</Text>
        ) : (
          <Text color={palette.dim}>—</Text>
        )}
      </Box>

      {/* Seasons (collapsible) */}
      {model.seasons.items.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.accent}>
            {seasonsExpanded ? "▾" : "▸"} {model.seasons.items.length} seasons (s)
          </Text>
          {seasonsExpanded
            ? model.seasons.items.map((season) => (
                <Text key={season.season} color={palette.text}>
                  {"  "}
                  {season.label}
                </Text>
              ))
            : null}
        </Box>
      ) : null}

      {/* Links + trailer */}
      {model.links.items.length > 0 || model.trailerUrl ? (
        <Box flexDirection="column" marginTop={1}>
          <SectionLabel>Links</SectionLabel>
          {model.trailerUrl ? <Text color={palette.accent}>▶ trailer (t)</Text> : null}
          {model.links.items.length > 0 ? (
            <Text color={palette.muted}>
              {model.links.items.map((link) => link.label).join(" · ")}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {/* Actions footer */}
      <Box marginTop={1}>
        <Text color={palette.dim}>
          ▶ play · + queue · w follow · d download · e episodes
          {model.trailerUrl ? " · t trailer" : ""}
          {model.links.items.length > 0 ? " · l links" : ""} · esc
        </Text>
      </Box>
    </Box>
  );
}
