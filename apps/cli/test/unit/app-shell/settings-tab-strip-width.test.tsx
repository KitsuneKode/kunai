import { describe, expect, test } from "bun:test";

import { ClaudeTabRow } from "@/app-shell/primitives/ClaudeTabRow";
import { buildSettingsPage } from "@/app-shell/settings/build-page";
import { SettingsOverlay } from "@/app-shell/settings/SettingsOverlay";
import { createSettingsUiState } from "@/app-shell/settings/state";
import type { SettingsRegistryContext } from "@/app-shell/settings/types";
import type { Container } from "@/container";
import { DEFAULT_CONFIG } from "@/services/persistence/ConfigStore";
import { SHIPPED_ANILIST_REDIRECT_URI } from "@/services/sync/auth-contract";
import React from "react";

import { render } from "../../harness/render-capture";
import { renderedWidth } from "../../support/rendered-width";

const SETTINGS_SECTIONS = [
  "General",
  "Sources",
  "Playback & Offline",
  "Accounts & Sync",
  "Privacy & System",
];

const COMPACT_SETTINGS_TABS = ["General", "Sources", "Playback", "Accounts", "Privacy"];

function mockRegistryCtx(): SettingsRegistryContext {
  return {
    config: DEFAULT_CONFIG,
    presenceSnapshot: null,
    seriesProviderOptions: [],
    animeProviderOptions: [],
    youtubeProviderOptions: [],
    sync: {
      adapters: [],
      authAvailability: {
        anilist: {
          available: true as const,
          redirectUri: SHIPPED_ANILIST_REDIRECT_URI,
          clientIdSource: "shipped-default" as const,
        },
        tmdb: { available: true as const, apiKeySource: "shipped-fallback" as const },
      },
      status: {
        connected: 0,
        pending: 0,
        needsReauth: 0,
        deadLettered: 0,
        health: "disconnected" as const,
      },
    },
    // SAFETY: render-only test fixture; container is never dereferenced by SettingsOverlay.
    container: {} as Container,
  };
}

function stripAt(columns: number, activeIndex: number, labels = SETTINGS_SECTIONS): string[] {
  const handle = render(
    <ClaudeTabRow
      labels={labels}
      activeIndex={activeIndex}
      hint={columns >= 100 ? "Tab / Shift+Tab" : undefined}
      maxWidth={columns}
    />,
    { columns },
  );
  const frame = handle.lastFrame();
  handle.unmount();
  return frame.split("\n").filter((line) => line.trim().length > 0);
}

function renderOverlayAt(columns: number, rows: number, activeSectionIndex: number): string {
  const registryCtx = mockRegistryCtx();
  const page = buildSettingsPage(registryCtx, { activeSectionIndex });
  const state = { ...createSettingsUiState(DEFAULT_CONFIG), activeSectionIndex };
  const handle = render(
    <SettingsOverlay
      page={page}
      state={state}
      registryCtx={registryCtx}
      width={columns}
      maxRows={Math.max(6, rows - 8)}
      error={null}
    />,
    { columns, rows },
  );
  const frame = handle.lastFrame();
  handle.unmount();
  return frame;
}

describe("Settings tab strip at narrow and wide viewports", () => {
  test("SettingsOverlay fits all five tabs on a single line at 64×22 without overflow", () => {
    for (let activeIndex = 0; activeIndex < COMPACT_SETTINGS_TABS.length; activeIndex += 1) {
      const frame = renderOverlayAt(64, 22, activeIndex);
      const lines = frame.split("\n");
      const tabLine = lines.find((line) => line.includes(COMPACT_SETTINGS_TABS[activeIndex]!));
      expect(tabLine).toBeDefined();
      expect(renderedWidth(tabLine ?? "")).toBeLessThanOrEqual(64);
      expect(tabLine).not.toContain("‹");
      expect(tabLine).not.toContain("›");
      for (const tab of COMPACT_SETTINGS_TABS) {
        expect(tabLine).toContain(tab);
      }
      for (const line of lines) {
        expect(renderedWidth(line)).toBeLessThanOrEqual(64);
      }
    }
  });

  test("SettingsOverlay fits all five full section names on a single line at 120×40", () => {
    for (let activeIndex = 0; activeIndex < SETTINGS_SECTIONS.length; activeIndex += 1) {
      const frame = renderOverlayAt(120, 40, activeIndex);
      const lines = frame.split("\n");
      const tabLine = lines.find((line) => line.includes(SETTINGS_SECTIONS[activeIndex]!));
      expect(tabLine).toBeDefined();
      expect(renderedWidth(tabLine ?? "")).toBeLessThanOrEqual(120);
      expect(tabLine).not.toContain("‹");
      expect(tabLine).not.toContain("›");
      expect(tabLine).toContain("Tab / Shift+Tab");
      for (const section of SETTINGS_SECTIONS) {
        expect(tabLine).toContain(section);
      }
    }
  });

  test("stays on one line at 80 columns instead of wrapping into stumps", () => {
    const lines = stripAt(80, 0);

    expect(lines).toHaveLength(1);
    expect(renderedWidth(lines[0] ?? "")).toBeLessThanOrEqual(80);
  });

  test("shows the active section name in full at every position", () => {
    for (const [index, section] of SETTINGS_SECTIONS.entries()) {
      const lines = stripAt(80, index);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(section);
    }
  });

  test("survives a very narrow terminal without wrapping", () => {
    for (const columns of [40, 50, 60, 64, 70]) {
      const lines = stripAt(columns, 2);
      expect(lines).toHaveLength(1);
      expect(renderedWidth(lines[0] ?? "")).toBeLessThanOrEqual(columns);
    }
  });
});
