import { Box, Text } from "ink";
import React from "react";

import type { PosterResult } from "../poster-types";
import { truncateLine } from "../shell-text";
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
}: {
  readonly model: PreviewRailModel;
  readonly width?: number;
  /** Rendered poster (chafa/Kitty placeholder). When ready, shown instead of the letter tile. */
  readonly poster?: PosterResult;
}) {
  const facts = visiblePreviewFacts(model.facts).slice(0, 4);
  const posterLabel = getPreviewPosterLabel(model);
  const hasPosterImage = poster !== undefined && poster.kind !== "none";
  return (
    <Box flexDirection="column" width={width}>
      {/* Borderless poster slot — height-reserved so the metadata below never
          jumps when artwork resolves. Renders the real poster; falls back to a
          quiet letter tile only while loading or when no art is available. */}
      <Box minHeight={hasPosterImage ? undefined : 6} justifyContent="center">
        {hasPosterImage ? (
          <Text>{poster.placeholder}</Text>
        ) : (
          <Text color={model.posterState === "loading" ? palette.muted : palette.dim} bold>
            {posterLabel}
          </Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.text} bold>
          {truncateLine(model.title, width - 2)}
        </Text>
        {model.subtitle ? (
          <Text color={palette.muted}>{truncateLine(model.subtitle, width - 2)}</Text>
        ) : null}
        {model.overview ? (
          <Box marginTop={1}>
            <Text color={palette.dim}>{truncateLine(model.overview, width - 2)}</Text>
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
