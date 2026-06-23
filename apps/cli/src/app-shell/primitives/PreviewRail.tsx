import { Box, Text } from "ink";
import React from "react";

import type { PosterResult } from "../poster-types";
import { truncateLine, wrapText } from "../shell-text";
import { palette } from "../shell-theme";
import {
  getPreviewPosterLabel,
  visiblePreviewFacts,
  type PreviewFact,
  type PreviewRailModel,
} from "./PreviewRail.model";

function factColor(tone: PreviewFact["tone"]): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "danger") return palette.danger;
  return palette.text;
}

export function PreviewRail({
  model,
  width = 32,
  poster,
  reserveRows = 6,
}: {
  readonly model: PreviewRailModel;
  readonly width?: number;
  /** Rendered poster (chafa/Kitty placeholder). When ready, shown instead of the letter tile. */
  readonly poster?: PosterResult;
  /**
   * Fixed height (in rows) for the poster slot. Both the resolved image and the
   * placeholder tile reserve this height so the placeholder -> image swap (e.g. on
   * selection settle) never reflows the metadata below it.
   */
  readonly reserveRows?: number;
}) {
  const facts = visiblePreviewFacts(model.facts).slice(0, 4);
  const posterLabel = getPreviewPosterLabel(model);
  const hasPosterImage = poster !== undefined && poster.kind !== "none";
  const bodyWidth = Math.max(16, width - 2);
  const overviewLines = model.overview ? wrapText(model.overview, bodyWidth, 3) : [];
  return (
    <Box flexDirection="column" width={width}>
      {/* Poster slot — height-reserved so the metadata below never jumps when
          artwork resolves. The real poster renders borderless; the fallback is a
          framed placeholder tile (initials centred in a poster-shaped frame) so it
          reads as "art pending" instead of two letters floating in empty space. */}
      {hasPosterImage ? (
        <Box minHeight={reserveRows} justifyContent="center">
          <Text>{poster.placeholder}</Text>
        </Box>
      ) : (
        <Box
          minHeight={reserveRows}
          width={bodyWidth}
          justifyContent="center"
          alignItems="center"
          borderStyle="round"
          borderColor={palette.lineSoft}
        >
          <Text color={model.posterState === "loading" ? palette.muted : palette.dim} bold>
            {posterLabel}
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.text} bold wrap="truncate">
          {truncateLine(model.title, bodyWidth)}
        </Text>
        {model.subtitle ? (
          <Text color={palette.muted} wrap="truncate">
            {truncateLine(model.subtitle, bodyWidth)}
          </Text>
        ) : null}
        {overviewLines.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            {overviewLines.map((line) => (
              <Text key={line} color={palette.dim} wrap="truncate">
                {line}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
      {facts.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          {facts.map((fact) => (
            <Text key={`${fact.label}:${fact.value}`}>
              <Text color={palette.muted}>{truncateLine(fact.label, 10)} </Text>
              <Text color={factColor(fact.tone)}>{truncateLine(fact.value, width - 13)}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
