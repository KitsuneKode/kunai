import { Box, Text } from "ink";
import React from "react";

import { plainModeEnabled } from "../../plain-mode";
import { palette } from "../../shell-theme";
import type { SettingRowDef } from "../types";

export const SettingsInputBanner = React.memo(function SettingsInputBanner({
  def,
  buffer,
  seed,
}: {
  readonly def: Extract<SettingRowDef, { kind: "text" }>;
  readonly buffer: string;
  readonly seed: string;
}) {
  const plain = plainModeEnabled();
  const display =
    def.sensitive && buffer
      ? plain
        ? `(${buffer.length} characters hidden)`
        : "•".repeat(Math.min(buffer.length, 24))
      : buffer;
  const saved = def.sensitive && seed ? "configured" : seed || "not set";

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text color={palette.accent} bold>
        {def.label}
      </Text>
      <Text color={palette.dim}>{def.placeholder}</Text>
      <Box marginTop={1}>
        <Text color={palette.accent}>{plain ? "Input (focused): " : "Input: "}</Text>
        <Text color={palette.text} bold>
          {display}
        </Text>
        {plain ? null : <Text color={palette.dim}>▌</Text>}
      </Box>
      <Text color={palette.dim} dimColor>
        {`Saved: ${saved}`}
        {def.envOverride && process.env[def.envOverride]?.trim() ? "  ·  (env override)" : ""}
        {"  ·  Paste supported · Enter save · Esc cancel · Ctrl+U clear"}
      </Text>
    </Box>
  );
});
