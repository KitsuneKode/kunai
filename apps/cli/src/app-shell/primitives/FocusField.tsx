import { Box, Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

/** Rose border when focused; quiet line when not — browse search / filter zones. */
export const FocusField = React.memo(function FocusField({
  focused,
  children,
  width,
}: {
  readonly focused: boolean;
  readonly children: React.ReactNode;
  readonly width?: number;
}) {
  return (
    <Box
      width={width}
      borderStyle="single"
      borderColor={focused ? palette.accent : palette.lineSoft}
      paddingX={1}
    >
      {children}
    </Box>
  );
});

export const FocusFieldLabel = React.memo(function FocusFieldLabel({
  label,
  focused,
}: {
  readonly label: string;
  readonly focused: boolean;
}) {
  return (
    <Text color={focused ? palette.accent : palette.muted} bold={focused}>
      {label}
    </Text>
  );
});
