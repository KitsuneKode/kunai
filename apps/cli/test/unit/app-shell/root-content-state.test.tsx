import { describe, expect, test } from "bun:test";

import {
  clearRootContentSession,
  getRootContentSession,
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

  test("resolvedRootContentFromSurface keeps browse/post-playback under overlay", () => {
    for (const kind of ["browse", "post-playback"] as const) {
      const session = mountRootContent({
        kind,
        fallbackValue: "done",
        renderContent: () => React.createElement("text", null, kind),
      });
      const mounted = getRootContentSession();
      expect(resolvedRootContentFromSurface("root-overlay", mounted)).toEqual({
        kind: "overlay-over-mounted",
        session: mounted,
      });
      session.close("done");
    }
    expect(resolvedRootContentFromSurface("root-overlay", null)).toEqual({ kind: "overlay" });
    expect(resolvedRootContentFromSurface("playback", null)).toEqual({ kind: "playback" });
    clearRootContentSession();
  });

  test("resolvedRootContentFromSurface unmounts picker/loading under overlay", () => {
    for (const kind of ["picker", "loading"] as const) {
      const session = mountRootContent({
        kind,
        fallbackValue: "done",
        renderContent: () => React.createElement("text", null, kind),
      });
      const mounted = getRootContentSession();
      expect(resolvedRootContentFromSurface("root-overlay", mounted)).toEqual({
        kind: "overlay",
      });
      session.close("done");
    }
    clearRootContentSession();
  });

  test("resolveRootContentFromSession preserves browse under diagnostics overlay", () => {
    const session = mountRootContent({
      kind: "browse",
      fallbackValue: "done",
      renderContent: () => React.createElement("text", null, "browse"),
    });
    const mounted = getRootContentSession();
    expect(
      resolveRootContentFromSession(
        baseSession({
          activeModals: [{ type: "diagnostics" }],
        }),
        { rootContent: mounted },
      ),
    ).toEqual({ kind: "overlay-over-mounted", session: mounted });
    session.close("done");
    clearRootContentSession();
  });

  test("resolveRootContentFromSession does not keep picker under diagnostics overlay", () => {
    const session = mountRootContent({
      kind: "picker",
      fallbackValue: "done",
      renderContent: () => React.createElement("text", null, "picker"),
    });
    expect(
      resolveRootContentFromSession(
        baseSession({
          activeModals: [{ type: "diagnostics" }],
        }),
        { rootContent: getRootContentSession() },
      ),
    ).toEqual({ kind: "overlay" });
    session.close("done");
    clearRootContentSession();
  });
});
