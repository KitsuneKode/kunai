import { Text } from "ink";
import React from "react";

import { palette } from "../shell-theme";

/** One calm info-tone insight line (e.g. streak/usage callouts). */
export const InsightLine = React.memo(function InsightLine({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Text color={palette.info}>{children}</Text>;
});
