import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  applyResolvedShareSideEffects,
  applyShareRefLaunch,
} from "@/app/bootstrap/apply-resolved-share-target";
import {
  consumeShareBootstrapStartSeconds,
  setShareBootstrapStartSeconds,
} from "@/app/bootstrap/share-bootstrap-start";
import type { Container } from "@/container";

// The bootstrap start position is a one-shot module-level mailbox; drain it around every
// test so a primed value can never leak into another test file's PlaybackPhase consume.
beforeEach(() => setShareBootstrapStartSeconds(undefined));
afterEach(() => setShareBootstrapStartSeconds(undefined));

function createApplyContainer(
  overrides: {
    readonly providerId?: string;
    readonly animeProvider?: string;
    readonly isAnimeProvider?: boolean;
    readonly availableProviders?: readonly string[];
    readonly mode?: "series" | "anime" | "youtube";
  } = {},
): {
  readonly container: Container;
  readonly notes: string[];
  readonly modes: string[];
  readonly providers: string[];
} {
  const notes: string[] = [];
  const modes: string[] = [];
  const providers: string[] = [];
  const providerId = overrides.providerId ?? "videasy";
  const available = new Set(overrides.availableProviders ?? [providerId, "allanime"]);

  const container = {
    stateManager: {
      getState: () => ({
        provider: providerId,
        mode: overrides.mode ?? "series",
        defaultProviders: { series: "videasy", anime: "allanime", youtube: "youtube" },
      }),
      dispatch: (event: { type: string; note?: string; mode?: string; provider?: string }) => {
        if (event.type === "SET_PLAYBACK_FEEDBACK" && event.note) notes.push(event.note);
        if (event.type === "SET_MODE" && event.mode) modes.push(event.mode);
        if (event.type === "SET_PROVIDER" && event.provider) providers.push(event.provider);
        if (event.type === "SET_MODE" && event.provider) providers.push(event.provider);
      },
    },
    config: { animeProvider: overrides.animeProvider ?? "allanime" },
    providerRegistry: {
      get: (id: string) =>
        available.has(id)
          ? {
              metadata: {
                id,
                isAnimeProvider: id === "allanime" || overrides.isAnimeProvider === true,
                isYoutubeProvider: id === "youtube",
              },
            }
          : null,
    },
  } as unknown as Container;

  return { container, notes, modes, providers };
}

describe("applyShareRefLaunch", () => {
  it("returns a search bootstrap for q= anchors and primes startSeconds", async () => {
    setShareBootstrapStartSeconds(undefined);
    const { container } = createApplyContainer();
    const launch = await applyShareRefLaunch(container, {
      action: "play",
      ref: { anchor: { by: "search", query: "naruto" }, kind: "anime", startSeconds: 42 },
    });
    expect(launch).toEqual({
      query: "naruto",
      autoPickSearchResultIndex: 1,
    });
    expect(consumeShareBootstrapStartSeconds()).toBe(42);
  });

  it("returns a direct title bootstrap for catalog anchors", async () => {
    const { container } = createApplyContainer();
    const launch = await applyShareRefLaunch(container, {
      action: "download",
      ref: {
        anchor: { by: "catalog", ns: "tmdb", id: "438631" },
        kind: "movie",
      },
    });
    expect(launch.title?.id).toBe("tmdb:438631");
    expect(launch.download).toBe(true);
    expect(launch.query).toBeUndefined();
  });
});

describe("applyResolvedShareSideEffects", () => {
  it("switches to anime mode and applies a valid anime provider hint", () => {
    const { container, modes } = createApplyContainer({
      availableProviders: ["videasy", "allanime"],
    });
    applyResolvedShareSideEffects(
      container,
      {
        title: { id: "anilist:21", type: "series", name: "One Piece", isAnime: true },
        mode: "anime",
      },
      {
        anchor: { by: "catalog", ns: "anilist", id: "21" },
        kind: "anime",
        hint: { providerId: "allanime" },
      },
    );
    expect(modes).toContain("anime");
  });

  it("surfaces resolver notes without crashing", () => {
    const { container, notes } = createApplyContainer();
    applyResolvedShareSideEffects(
      container,
      {
        title: { id: "tmdb:1399", type: "series", name: "GoT" },
        mode: "series",
        note: 'Shared source "missing" isn\'t available here — using your default provider.',
      },
      {
        anchor: { by: "catalog", ns: "tmdb", id: "1399" },
        kind: "series",
        hint: { providerId: "missing" },
      },
    );
    expect(notes[0]).toContain("missing");
  });

  it("moves a movie link out of anime mode onto the series lane default", () => {
    const { container, modes, providers } = createApplyContainer({ mode: "anime" });
    applyResolvedShareSideEffects(
      container,
      { title: { id: "tmdb:438631", type: "movie", name: "Dune" }, mode: "series" },
      { anchor: { by: "catalog", ns: "tmdb", id: "438631" }, kind: "movie" },
    );
    expect(modes).toEqual(["series"]);
    expect(providers).toEqual(["videasy"]);
  });

  it("moves a video link onto the youtube lane", () => {
    const { container, modes, providers } = createApplyContainer({
      mode: "anime",
      availableProviders: ["videasy", "allanime", "youtube"],
    });
    applyResolvedShareSideEffects(
      container,
      { title: { id: "youtube:abc", type: "movie", name: "Clip" }, mode: "youtube" },
      { anchor: { by: "catalog", ns: "youtube", id: "abc" }, kind: "video" },
    );
    expect(modes).toEqual(["youtube"]);
    expect(providers).toEqual(["youtube"]);
  });

  it("keeps the session provider when the link is already in the current lane", () => {
    const { container, modes, providers } = createApplyContainer({ mode: "series" });
    applyResolvedShareSideEffects(
      container,
      { title: { id: "tmdb:1399", type: "series", name: "GoT" }, mode: "series" },
      { anchor: { by: "catalog", ns: "tmdb", id: "1399" }, kind: "series" },
    );
    expect(modes).toEqual([]);
    expect(providers).toEqual([]);
  });

  it("ignores a provider hint from another lane", () => {
    const { container, providers } = createApplyContainer({ mode: "series" });
    applyResolvedShareSideEffects(
      container,
      { title: { id: "tmdb:1399", type: "series", name: "GoT" }, mode: "series" },
      {
        anchor: { by: "catalog", ns: "tmdb", id: "1399" },
        kind: "series",
        hint: { providerId: "allanime" },
      },
    );
    expect(providers).toEqual([]);
  });
});
