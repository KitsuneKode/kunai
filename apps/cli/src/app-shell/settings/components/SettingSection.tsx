import { Box, Text } from "ink";
import React from "react";

import { SectionGroup } from "../../primitives/SectionGroup";
import { palette, semanticToneColor } from "../../shell-theme";
import type { SectionLayout } from "../layouts";
import type { BuiltSettingsRow } from "../types";

export const SettingSection = React.memo(function SettingSection({
  row,
  layout,
}: {
  readonly row: BuiltSettingsRow;
  readonly layout?: SectionLayout;
}) {
  if (row.def.kind !== "section") return null;
  const isDanger = layout === "danger-zone" || row.def.layout === "danger-zone";
  return (
    <SectionGroup label={row.def.label} marginTop={layout === "compact" ? 0 : 1} rule={!isDanger} />
  );
});

export const SettingRowStatus = React.memo(function SettingRowStatus({
  row,
}: {
  readonly row: BuiltSettingsRow;
}) {
  if (row.def.kind !== "status") return null;
  const tone =
    row.def.tone === "success"
      ? palette.ok
      : row.def.tone === "warning"
        ? semanticToneColor("warning")
        : row.def.tone === "error"
          ? palette.danger
          : semanticToneColor("info");
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text color={tone}>{row.def.label}</Text>
      {row.detail ? (
        <Text color={palette.dim} dimColor>
          {row.detail}
        </Text>
      ) : null}
    </Box>
  );
});

export const SettingRowAction = React.memo(function SettingRowAction({
  row,
  selected,
  rowWidth,
}: {
  readonly row: BuiltSettingsRow;
  readonly selected: boolean;
  readonly rowWidth: number;
}) {
  if (row.def.kind !== "action") return null;
  const danger = row.def.tone === "danger";
  return (
    <Box width={rowWidth} backgroundColor={selected ? palette.surfaceActive : undefined}>
      <Text color={selected ? palette.accent : palette.dim}>{selected ? "▌ " : "  "}</Text>
      {danger ? <Text color={palette.danger}>! </Text> : null}
      <Text
        bold={selected}
        color={danger ? palette.danger : selected ? palette.text : palette.textDim}
      >
        {row.def.label}
      </Text>
    </Box>
  );
});
