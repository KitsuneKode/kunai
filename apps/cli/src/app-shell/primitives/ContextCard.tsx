import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";
import {
  buildContextCardTile,
  clampContextCardText,
  contextCardGlyph,
  type ContextCardModel,
} from "./ContextCard.model";

export function ContextCard({
  model,
  width = 34,
  selected = false,
}: {
  readonly model: ContextCardModel;
  readonly width?: number;
  readonly selected?: boolean;
}) {
  const tile = buildContextCardTile(model.title);
  const textWidth = Math.max(8, width - 10);
  const glyph = contextCardGlyph(model);
  const toneColor =
    model.stateTone === "success"
      ? palette.ok
      : model.stateTone === "warning"
        ? palette.accentDeep
        : model.stateTone === "danger"
          ? palette.danger
          : palette.dim;

  return (
    <Box width={width} flexDirection="row">
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      <Text color={palette.accent}>{tile.padEnd(2).slice(0, 2)}</Text>
      <Text color={palette.dim}> </Text>
      <Box flexDirection="column" width={textWidth}>
        <Text color={palette.text} bold>
          {clampContextCardText(model.title, textWidth)}
        </Text>
        {model.subtitle ? (
          <Text color={palette.muted}>{clampContextCardText(model.subtitle, textWidth)}</Text>
        ) : null}
      </Box>
      <Text color={toneColor}>{glyph}</Text>
    </Box>
  );
}

export default ContextCard;
