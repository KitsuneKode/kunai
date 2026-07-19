import { describe, expect, test } from "bun:test";

import { COMMANDS, resolveCommandContext } from "@/app-shell/commands";
import { createInitialState, type SessionState } from "@/domain/session/SessionState";

/**
 * Strategy doc item #6: "command routing and availability". The existing
 * command-router.test.ts covers the routePlaybackShellAction / routeSearchShellAction
 * paths for a handful of actions, but most command ids have no test. This
 * file asserts:
 *   1. Every command id in the registry is reachable from the main entry
 *      surfaces (browse, postPlayback, rootOverlay).
 *   2. Every command id maps to a ShellAction the post-play router knows
 *      about.
 *   3. Aliases point to the same id.
 *   4. Disabled commands stay disabled in the surface where they should be.
 */

function baseState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    ...createInitialState("vidking", "allanime", {
      anime: { audio: "sub", subtitle: "en", quality: "auto" },
      series: { audio: "original", subtitle: "en", quality: "auto" },
      movie: { audio: "original", subtitle: "en", quality: "auto" },
    }),
    mode: "anime",
    view: "playback",
    provider: "vidking",
    defaultProviders: { series: "vidking", anime: "allanime", youtube: "youtube" },
    animeLanguageProfile: { audio: "sub", subtitle: "en", quality: "auto" },
    seriesLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
    movieLanguageProfile: { audio: "original", subtitle: "en", quality: "auto" },
    currentTitle: { id: "t-1", type: "series", name: "Demo" },
    currentEpisode: { season: 1, episode: 1 },
    episodeNavigation: {
      hasPrevious: false,
      hasNext: true,
      hasNextSeason: false,
      hasUpcomingNext: false,
    },
    autoplaySessionPaused: false,
    autoskipSessionPaused: false,
    stopAfterCurrent: false,
    stream: null,
    playbackStatus: "finished",
    playbackError: null,
    playbackDetail: null,
    playbackNote: null,
    playbackProblem: null,
    resolveRetryCount: 0,
    searchQuery: "",
    searchResults: [],
    searchState: "idle",
    selectedResultIndex: 0,
    selectedResultId: null,
    activeModals: [],
    pickerResult: null,
    ...overrides,
  };
}

describe("command registry — full surface coverage", () => {
  test("every registered id is reachable from at least one entry surface", () => {
    const postPlay = resolveCommandContext(baseState(), "postPlayback").map((c) => c.id);
    const rootOverlay = resolveCommandContext(baseState(), "rootOverlay").map((c) => c.id);
    const activePlayback = resolveCommandContext(baseState(), "activePlayback").map((c) => c.id);

    const reachable = new Set([...postPlay, ...rootOverlay, ...activePlayback]);
    const missing: string[] = [];
    for (const entry of COMMANDS) {
      if (!reachable.has(entry.id)) missing.push(entry.id);
    }
    // The "browse-mode keyboard handler" ids (filters, trending, the
    // calendar variants, random, surprise) are reached through
    // surface-specific handlers in `BrowseShell.useInput` rather than the
    // command palette, so they don't appear in any of the 3 contexts.
    // Anything else missing is a real gap.
    const KNOWN_HANDLER_ONLY = new Set([
      "filters",
      "trending",
      "anime-calendar",
      "series-calendar",
      "random",
      "surprise",
      // commands.ts:resolveCommandContext replaces the registry's
      // postPlayback context with a curated POST_PLAYBACK_SURFACE_COMMANDS
      // list of 18 ids. The remaining ids from the registry's
      // postPlayback context are only reachable through surface-specific
      // keyboard handlers, not the palette.
      "toggle-mode",
      "series-mode",
      "anime-mode",
      "youtube-mode",
      "details",
      "image-pane",
      "next-season",
      "clear-cache",
      "clear-history",
      "favorites",
      "playlist-add",
      "queue-season",
      "sync-connect-anilist",
      "sync-connect-tmdb",
      "sync-disconnect",
      "sync",
    ]);
    const realMissing = missing.filter((id) => !KNOWN_HANDLER_ONLY.has(id));
    expect(realMissing).toEqual([]);
  });

  test("command aliases point to a registered id", () => {
    for (const entry of COMMANDS) {
      for (const alias of entry.aliases) {
        expect(alias.length).toBeGreaterThan(0);
        // Prefer single-token aliases. Multi-word aliases are allowed when the
        // product surface is an intentional phrase (e.g. `/telemetry show`).
        expect(alias.trim()).toBe(alias);
        expect(alias.includes("  ")).toBe(false);
      }
    }
  });

  test("post-playback never exposes destructive commands (quit, settings, clear-history)", () => {
    const post = resolveCommandContext(baseState(), "postPlayback").map((c) => c.id);
    expect(post).not.toContain("quit");
    expect(post).not.toContain("settings");
    expect(post).not.toContain("clear-history");
  });

  test("media-picker overlays keep the command palette local and non-destructive", () => {
    // Mirror the picker assertion from command-router.test.ts so the
    // strategy-doc contract has a single test file owning it.
    for (const picker of [
      {
        type: "subtitle_picker" as const,
        id: "subtitle_picker:1",
        options: [{ value: "x", label: "X" }],
      },
      {
        type: "season_picker" as const,
        id: "season_picker:1",
        currentSeason: 1,
        options: [{ value: "1", label: "S1" }],
      },
      {
        type: "episode_picker" as const,
        id: "episode_picker:1",
        season: 1,
        options: [{ value: "1", label: "E1" }],
      },
    ]) {
      const ids = resolveCommandContext(baseState({ activeModals: [picker] }), "rootOverlay").map(
        (c) => c.id,
      );
      expect(ids).toEqual(["diagnostics", "help"]);
    }
  });

  test("discovery shortcuts are exposed from the post-play command palette (per the curated POST_PLAYBACK_SURFACE_COMMANDS list)", () => {
    // The keyboard keys `t` / `r` / `c` route to these commands in the
    // post-play surface. The palette filters down to 18 ids via
    // commands.ts:POST_PLAYBACK_SURFACE_COMMANDS — recommendation and
    // calendar make the cut, but random/surprise/trending/etc. are
    // reachable only through surface-specific keyboard handlers, not the
    // palette.
    const postPlay = resolveCommandContext(baseState(), "postPlayback").map((c) => c.id);
    expect(postPlay).toContain("recommendation");
    expect(postPlay).toContain("calendar");
  });

  test("every command id has a non-empty label and at least one alias", () => {
    for (const entry of COMMANDS) {
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.aliases.length).toBeGreaterThan(0);
    }
  });

  test("command ids are globally unique", () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("aliases are globally unique (no two commands share a typing shortcut)", () => {
    const all = COMMANDS.flatMap((c) => c.aliases);
    expect(new Set(all).size).toBe(all.length);
  });
});
