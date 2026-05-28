import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

/** Uppercase section label with trailing rule (Sakura systems shelf bands). */
export const SectionGroup = React.memo(function SectionGroup({
  label,
  marginTop = 1,
}: {
  readonly label: string;
  readonly marginTop?: number;
}) {
  return (
    <Box marginTop={marginTop} marginBottom={0} flexDirection="row" gap={1} width="100%">
      <Text color={palette.muted}>{label.toUpperCase()}</Text>
      <Box
        flexGrow={1}
        borderStyle="single"
        borderBottom
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderColor={palette.lineSoft}
        height={0}
        marginTop={1}
      />
    </Box>
  );
});

export const FieldLabel = React.memo(function FieldLabel({ label }: { readonly label: string }) {
  return (
    <Box marginTop={1} marginBottom={0}>
      <Text color={palette.muted}>{label.toUpperCase()}</Text>
    </Box>
  );
});
