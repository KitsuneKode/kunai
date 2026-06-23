import { Text } from "ink";
import React from "react";

import { palette } from "../../shell-theme";
import { settingsEqual } from "../settings-equal";
import type { SettingsUiState } from "../types";

export const SettingsFooter = React.memo(function SettingsFooter({
  state,
  mode,
}: {
  readonly state: SettingsUiState;
  readonly mode: "main" | "submenu" | "input";
}) {
  const dirty = !settingsEqual(state.draft, state.snapshot);
  const hints =
    mode === "input"
      ? "Enter save · Esc cancel · Ctrl+U clear"
      : mode === "submenu"
        ? "Enter pick · [ ] reorder · Esc back"
        : "Space toggle · Enter open · / search · Esc close";

  return (
    <Text color={palette.dim}>{`${hints}${dirty ? "  ·  changes apply automatically" : ""}`}</Text>
  );
});
