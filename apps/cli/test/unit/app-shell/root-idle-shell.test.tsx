import { describe, expect, test } from "bun:test";

import { RootIdleShell } from "@/app-shell/root-status-shells";
import type { SessionState } from "@/domain/session/SessionState";
import type { TitleInfo } from "@/domain/types";
import React from "react";

import { CAPTURE_WIDTHS, captureFrame } from "../../harness/render-capture";

const TITLE: TitleInfo = { id: "tmdb:1", type: "series", name: "The Rookie" };

function idleState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    mode: "series",
    view: "home",
    currentTitle: null,
    currentEpisode: null,
    searchState: "idle",
    searchQuery: "",
    ...overrides,
  } as SessionState;
}

function frame(state: SessionState): string {
  return captureFrame(<RootIdleShell state={state} />, { columns: CAPTURE_WIDTHS.medium });
}

describe("RootIdleShell", () => {
  test("a selected title awaiting playback shows the preparing loader", () => {
    // SELECT_TITLE sets view:"details" with playbackStatus idle; this window is
    // the resolve gap that previously showed a static, loader-less screen.
    const out = frame(idleState({ currentTitle: TITLE, view: "details" }));
    expect(out).toContain("Preparing The Rookie");
    expect(out).toContain("Resolving sources");
  });

  test("a resting paused session shows the resume hints, not a loader", () => {
    // A real session sits at view:"playback" (every launch dispatches
    // SELECT_EPISODE), so the loader must not appear on the resume screen.
    const out = frame(idleState({ currentTitle: TITLE, view: "playback" }));
    expect(out).toContain("/history to continue");
    expect(out).not.toContain("Preparing");
  });

  test("a bootstrap search still shows the searching loader", () => {
    const out = frame(idleState({ view: "search", searchState: "loading", searchQuery: "dune" }));
    expect(out).toContain("Searching dune");
    expect(out).not.toContain("Preparing");
  });

  test("no session shows the welcome screen", () => {
    const out = frame(idleState());
    expect(out.toLowerCase()).toContain("welcome to kunai");
    expect(out).not.toContain("Preparing");
  });
});
