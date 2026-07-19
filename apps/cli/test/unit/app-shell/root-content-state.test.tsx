import { describe, expect, test } from "bun:test";

import {
  clearRootContentSession,
  getRootContentSession,
  isRetainableRootContentKind,
  mountRootContent,
  type RootContentKind,
  resolveRootContentFromSession,
  resolvedRootContentFromSurface,
} from "@/app-shell/root-content-state";
import type { SessionState } from "@/domain/session/SessionState";
import React from "react";

function baseSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    mode: "anime",
    view: "home",
    searchQuery: "",
    searchResults: [],
    selectedResultIndex: 0,
    searchState: "idle",
    currentTitle: null,
    currentEpisode: null,
    provider: "allanime",
    stream: null,
    playbackStatus: "idle",
    playbackDetail: null,
    playbackError: null,
    playbackProblem: null,
    playbackNote: null,
    resolveRetryCount: 0,
    episodeNavigation: {
      hasPrevious: false,
      hasNext: false,
      hasNextSeason: false,
      hasUpcomingNext: false,
    },
    activeModals: [],
    imageSupport: false,
    autoplaySessionPaused: false,
    autoskipSessionPaused: false,
    stopAfterCurrent: false,
    watchTimeSummary: null,
    layout: {
      viewport: { columns: 120, rows: 40 },
      preferences: { imagePreview: "auto" },
      responsive: { breakpoint: "wide", showCompanion: true, showPoster: true },
    },
    ...overrides,
  } as SessionState;
}

describe("root content state", () => {
  test("supports all primary mounted-shell content kinds", () => {
    const kinds: readonly RootContentKind[] = [
      "browse",
      "loading",
      "playback",
      "post-playback",
      "picker",
    ];

    for (const kind of kinds) {
      const session = mountRootContent({
        kind,
        fallbackValue: "done",
        renderContent: () => React.createElement("text", null, kind),
      });

      expect(getRootContentSession()?.kind).toBe(kind);
      session.close("done");
      expect(getRootContentSession()).toBeNull();
    }

    clearRootContentSession();
  });

  test("resolveRootContentFromSession maps playback and mounted browse content", () => {
    const session = mountRootContent({
      kind: "browse",
      fallbackValue: "done",
      renderContent: () => React.createElement("text", null, "browse"),
    });

    expect(
      resolveRootContentFromSession(baseSession(), { rootContent: getRootContentSession() }),
    ).toEqual({ kind: "mounted", session: getRootContentSession() });

    session.close("done");

    expect(
      resolveRootContentFromSession(baseSession({ playbackStatus: "loading" }), {
        rootContent: null,
      }),
    ).toEqual({ kind: "playback" });

    expect(
      resolveRootContentFromSession(baseSession({ playbackStatus: "error", playbackError: "x" }), {
        rootContent: null,
      }),
    ).toEqual({ kind: "error" });

    clearRootContentSession();
  });

  test("resolvedRootContentFromSurface prefers overlay during active playback", () => {
    expect(resolvedRootContentFromSurface("root-overlay", null)).toEqual({ kind: "overlay" });
    expect(resolvedRootContentFromSurface("playback", null)).toEqual({ kind: "playback" });
  });

  test("resolvedRootContentFromSurface retains browse/post-playback sessions beneath an overlay", () => {
    const browseSession = {
      id: 41,
      kind: "browse",
      element: React.createElement("text", null, "browse"),
    } as const;

    expect(resolvedRootContentFromSurface("root-overlay", browseSession)).toEqual({
      kind: "overlay-over-mounted",
      session: browseSession,
    });

    expect(
      resolvedRootContentFromSurface("root-overlay", {
        ...browseSession,
        kind: "post-playback",
      }),
    ).toMatchObject({ kind: "overlay-over-mounted" });

    for (const kind of ["picker", "loading"] as const) {
      expect(
        resolvedRootContentFromSurface("root-overlay", {
          ...browseSession,
          kind,
        }),
      ).toEqual({ kind: "overlay" });
    }
  });

  test("isRetainableRootContentKind only allows browse and post-playback", () => {
    expect(isRetainableRootContentKind("browse")).toBe(true);
    expect(isRetainableRootContentKind("post-playback")).toBe(true);
    expect(isRetainableRootContentKind("picker")).toBe(false);
    expect(isRetainableRootContentKind("loading")).toBe(false);
    expect(isRetainableRootContentKind("playback")).toBe(false);
  });
});
