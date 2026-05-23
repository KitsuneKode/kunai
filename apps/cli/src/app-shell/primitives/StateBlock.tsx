import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";
import { ActionList, type ActionRowModel } from "./ActionList";

export type StateBlockKind = "loading" | "empty" | "info" | "success" | "error";
export type StateBlockTone = "muted" | "info" | "success" | "danger";

export type StateBlockModel = {
  readonly kind: StateBlockKind;
  readonly title: string;
  readonly detail?: string;
  readonly actions?: readonly ActionRowModel[];
};

export function getStateBlockGlyph(kind: StateBlockKind): string {
  if (kind === "loading") return "◐";
  if (kind === "empty") return "·";
  if (kind === "success") return "✓";
  if (kind === "error") return "×";
  return "●";
}

export function getStateBlockTone(kind: StateBlockKind): StateBlockTone {
  if (kind === "error") return "danger";
  if (kind === "success") return "success";
  if (kind === "info" || kind === "loading") return "info";
  return "muted";
}

function colorForTone(tone: StateBlockTone): string {
  if (tone === "danger") return palette.danger;
  if (tone === "success") return palette.ok;
  if (tone === "info") return palette.accentDeep;
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

export default StateBlock;
