import { Box, Text } from "ink";
import React from "react";

import { plainDecorationsActive, sectionSeparatorText } from "./decoration-policy";
import { palette } from "./shell-theme";

export const SectionSeparator = React.memo(function SectionSeparator({
  width,
  label,
  ruleWidth,
  marginTop = 1,
  color = palette.lineSoft,
}: {
  readonly width: number;
  readonly label?: string;
  readonly ruleWidth?: number;
  readonly marginTop?: number;
  readonly color?: string;
}) {
  const model = sectionSeparatorText({ width, label, ruleWidth });
  if (model.kind === "blank") {
    return <Box marginTop={marginTop} />;
  }
  if (model.kind === "label") {
    return (
      <Box marginTop={marginTop}>
        <Text color={palette.muted}>{model.text}</Text>
      </Box>
    );
  }
  return (
    <Box marginTop={marginTop} flexDirection="row" flexWrap="nowrap">
      <Text color={color}>{model.text}</Text>
    </Box>
  );
});

export function headerStatusPrefix(active: boolean): string {
  if (!active) return "";
  return plainDecorationsActive() ? "" : "● ";
}
