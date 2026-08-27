import { Box, Text } from "ink";
import React from "react";

import { companionFallbackGlyph, companionMode } from "../companion-policy";
import { companionLineFor } from "../kanna-voice";
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

/**
 * The empty / loading / error surface every list shell shares.
 *
 * On the two kinds that leave a person with nothing to look at — `empty` and
 * `error` — the companion adds one short line. That is the whole of her
 * presence here: text, so it reaches every terminal rather than the four that
 * can host a graphics protocol, and one row, so no pane has to be re-laid out
 * to accommodate her. `KUNAI_PET=off` silences it along with everything else.
 */
export function StateBlock({
  model,
  width = 76,
}: {
  readonly model: StateBlockModel;
  readonly width?: number;
}) {
  const tone = getStateBlockTone(model.kind);
  const color = colorForTone(tone);
  // Fixed when this surface mounts, so re-rendering the pane (a keystroke, a
  // resize) never re-rolls the line out from under the reader.
  const [pick] = React.useState(() => Math.floor(Math.random() * 997));
  const companion = companionLineFor(model.kind, companionMode(), pick);

  return (
    <Box flexDirection="column">
      <Text color={color} bold>
        {getStateBlockGlyph(model.kind)} {model.title}
      </Text>
      {model.detail ? <Text color={palette.muted}>{model.detail}</Text> : null}
      {companion ? (
        <Text color={palette.dim}>
          {companionFallbackGlyph()} {companion}
        </Text>
      ) : null}
      {model.actions && model.actions.length > 0 ? (
        <Box marginTop={1}>
          <ActionList rows={model.actions} width={width} />
        </Box>
      ) : null}
    </Box>
  );
}
