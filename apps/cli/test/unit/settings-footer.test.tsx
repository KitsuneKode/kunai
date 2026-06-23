import { expect, test } from "bun:test";

import { SettingsFooter } from "@/app-shell/settings/components/SettingsFooter";
import { createSettingsUiState } from "@/app-shell/settings/state";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import React from "react";

import { captureFrame } from "../harness/render-capture";

test("settings footer describes immediate apply instead of staged draft changes", () => {
  const state = {
    ...createSettingsUiState(DEFAULT_CONFIG),
    draft: { ...DEFAULT_CONFIG, showMemory: !DEFAULT_CONFIG.showMemory },
  };

  const frame = captureFrame(<SettingsFooter state={state} mode="main" />, { columns: 120 });

  expect(frame).toContain("changes apply automatically");
  expect(frame).not.toContain("draft");
});
