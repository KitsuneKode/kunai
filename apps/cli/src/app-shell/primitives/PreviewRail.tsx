import { Box, Text } from "ink";
import React from "react";

import { truncateLine } from "../shell-text";
import { palette } from "../shell-theme";
import { buildContextCardTile } from "./ContextCard";

export type PreviewPosterState = "none" | "loading" | "ready" | "failed";

export type PreviewFact = {
  readonly label: string;
  readonly value: string;
  readonly tone?: "success" | "warning" | "danger" | "muted";
};

export type PreviewRailModel = {
  readonly title: string;
  readonly subtitle?: string;
  readonly overview?: string;
  readonly posterUrl?: string;
  readonly posterState: PreviewPosterState;
  readonly facts: readonly PreviewFact[];
};

export function getPreviewPosterLabel(
  input: Pick<PreviewRailModel, "title" | "posterState">,
): string {
  if (input.posterState === "loading") return "loading poster";
  return buildContextCardTile(input.title);
}

export function visiblePreviewFacts(facts: readonly PreviewFact[]): readonly PreviewFact[] {
  return facts.filter((fact) => fact.label.trim().length > 0 && fact.value.trim().length > 0);
}

export function shouldRenderPreviewRail(input: {
  readonly columns: number;
  readonly hasModel: boolean;
}): boolean {
  return input.hasModel && input.columns >= 124;
}

function factColor(tone: PreviewFact["tone"]): string {
  if (tone === "success") return palette.ok;
  if (tone === "warning") return palette.accentDeep;
  if (tone === "danger") return palette.danger;
  return palette.text;
}

export function PreviewRail({
  model,
  width = 32,
}: {
  readonly model: PreviewRailModel;
  readonly width?: number;
}) {
  const facts = visiblePreviewFacts(model.facts).slice(0, 4);
  const posterLabel = getPreviewPosterLabel(model);
  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={palette.line}
      paddingX={1}
    >
      <Box minHeight={6} justifyContent="center">
        <Text color={model.posterState === "loading" ? palette.muted : palette.accent} bold>
          {posterLabel}
        </Text>
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

export default PreviewRail;
