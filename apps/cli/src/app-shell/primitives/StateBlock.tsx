import { Box, Text } from "ink";
import React from "react";

import { palette, semanticToneColor } from "../shell-theme";
import { ActionList } from "./ActionList";
import {
  getStateBlockGlyph,
  getStateBlockTone,
  type StateBlockModel,
  type StateBlockTone,
} from "./StateBlock.model";

function colorForTone(tone: StateBlockTone): string {
  if (tone === "danger") return palette.danger;
  if (tone === "success") return palette.ok;
  if (tone === "info") return semanticToneColor("info");
  return palette.dim;
}

export function StateBlock({
  model,
  width = 76,
}: {
  readonly model: StateBlockModel;
  readonly width?: number;
}) {
  const tone = getStateBlockTone(model.kind);
  const color = colorForTone(tone);
  return (
    <Box flexDirection="column">
      <Text color={color} bold>
        {getStateBlockGlyph(model.kind)} {model.title}
      </Text>
      {model.detail ? <Text color={palette.muted}>{model.detail}</Text> : null}
      {model.actions && model.actions.length > 0 ? (
        <Box marginTop={1}>
          <ActionList rows={model.actions} width={width} />
        </Box>
      ) : null}
    </Box>
  );
}
