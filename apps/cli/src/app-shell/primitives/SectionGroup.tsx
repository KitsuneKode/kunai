import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

/** Uppercase section label with an inline trailing rule (Sakura systems shelf bands).
 *  The rule sits on the SAME line as the label; an optional `tag` shows quiet
 *  secondary context (e.g. a week marker) between the label and the rule. */
export const SectionGroup = React.memo(function SectionGroup({
  label,
  tag,
  marginTop = 1,
  rule = true,
}: {
  readonly label: string;
  readonly tag?: string;
  readonly marginTop?: number;
  /** When false, render only the label (+ tag) with no trailing rule. */
  readonly rule?: boolean;
}) {
  return (
    <Box
      marginTop={marginTop}
      marginBottom={0}
      flexDirection="row"
      gap={1}
      width="100%"
      overflow="hidden"
    >
      <Text color={palette.muted}>{label.toUpperCase()}</Text>
      {tag ? (
        <Text color={palette.dim} dimColor>
          {tag}
        </Text>
      ) : null}
      {rule ? (
        <Box
          flexGrow={1}
          borderStyle="single"
          borderBottom
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          borderColor={palette.lineSoft}
          height={1}
        />
      ) : null}
    </Box>
  );
});
