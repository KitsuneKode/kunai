import { describe, expect, it } from "bun:test";

import { KEYBINDINGS, type KeyBinding } from "@/app-shell/keybindings";
import {
  buildPostPlayView,
  firstSelectableActionIndex,
  movePostPlayActionSelection,
  resolvePostPlayUnhandledInput,
} from "@/app-shell/post-play-view";

describe("buildDiscovery posters", () => {
  it("resolves a TMDB posterUrl from posterPath", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [
        { id: "r1", title: "Frieren", type: "series", posterPath: "/abc.jpg", year: "2023" },
      ],
    });
    expect(view.discovery[0]?.posterUrl).toBe("https://image.tmdb.org/t/p/w185/abc.jpg");
  });

  it("leaves posterUrl undefined when posterPath absent", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      postPlayState: { kind: "mid-series" },
      recommendations: [{ id: "r1", title: "Frieren", type: "series", year: "2023" }],
    });
    expect(view.discovery[0]?.posterUrl).toBeUndefined();
  });
});

describe("nextUpHero", () => {
  it("builds a hero for mid-series with the next episode label", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E01",
      nextEpisodeLabel: "S01 E02 — Challengers of Science",
      postPlayState: { kind: "mid-series" },
    });
    expect(view.nextUpHero).toBeDefined();
    expect(view.nextUpHero?.label).toBe("E02 · Challengers of Science");
    expect(view.nextUpHero?.kind).toBe("next-episode");
  });

  it("omits the hero when there is no next thing to play", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E12",
      postPlayState: { kind: "caught-up" },
    });
    expect(view.nextUpHero).toBeUndefined();
  });
});

describe("post-play action shortcuts", () => {
  it("derives action-row shortcuts from the keybinding registry", () => {
    const bindings: readonly KeyBinding[] = KEYBINDINGS.map((binding) =>
      binding.id === "post-source" ? { ...binding, chord: { input: "z" } } : binding,
    );

    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E02",
      postPlayState: { kind: "did-not-start" },
      bindings,
    });

    expect(view.actions.find((action) => action.id === "source")?.shortcut).toBe("z");
  });

  it("derives session-control hints from the postPlayback-scoped bindings", () => {
    const bindings: readonly KeyBinding[] = KEYBINDINGS.map((binding) =>
      binding.id === "post-autoskip" ? { ...binding, chord: { input: "y" } } : binding,
    );

    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E02",
      postPlayState: { kind: "mid-series" },
      bindings,
    });

    expect(view.actions.find((action) => action.id === "session-controls")?.shortcut).toBe(
      "a · y · x",
    );
  });

  it("marks the Session row non-selectable — its letters work, the row is a status", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S01 E02",
      postPlayState: { kind: "mid-series" },
    });

    const session = view.actions.find((action) => action.id === "session-controls");
    expect(session?.selectable).toBe(false);
    // Navigation starts on an Enter-able row and skips the Session row.
    const first = firstSelectableActionIndex(view.actions);
    expect(view.actions[first]?.selectable).not.toBe(false);
    const before = view.actions.findIndex((action) => action.id === "session-controls");
    const afterDown = movePostPlayActionSelection(view.actions, before - 1, 1);
    expect(afterDown).not.toBe(before);
    expect(view.actions[afterDown]?.selectable).not.toBe(false);
    const afterUp = movePostPlayActionSelection(view.actions, before + 1, -1);
    expect(afterUp).not.toBe(before);
    expect(view.actions[afterUp]?.selectable).not.toBe(false);
  });

  it("routes the session-toggle letters to real post-play results", () => {
    const ctx = {
      postPlayStateKind: "mid-series",
      selectedActionAvailable: true,
      recommendationCount: 0,
    } as const;

    expect(resolvePostPlayUnhandledInput("a", {}, ctx)).toEqual({
      type: "shell-result",
      result: "toggle-autoplay",
    });
    expect(resolvePostPlayUnhandledInput("u", {}, ctx)).toEqual({
      type: "shell-result",
      result: "toggle-autoskip",
    });
    expect(resolvePostPlayUnhandledInput("x", {}, ctx)).toEqual({
      type: "shell-result",
      result: "stop-after-current",
    });
  });
});

describe("anime film complete", () => {
  it("uses movie-complete, not episode-count progress, and aired/runtime meta", () => {
    const view = buildPostPlayView({
      title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
      episodeLabel: "",
      titleType: "movie",
      postPlayState: { kind: "mid-series" },
      totalEpisodes: 2,
      watchedEpisodes: 1,
      titleDetail: {
        id: "anilist:181053",
        type: "movie",
        title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
        releaseDate: "2025-07-18",
        runtimeMinutes: 155,
      },
    });
    expect(view.heroKind).toBe("movie-complete");
    expect(view.progressBar).toBeUndefined();
    expect(view.episodeMeta).toBe("2025-07-18 · 2h 35m");
    expect(view.episodeMeta).not.toContain("S01");
  });
});

describe("series-complete celebration", () => {
  it("includes catalog stats and the watch-time summary when provided", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S02 E12",
      postPlayState: { kind: "series-complete" },
      totalEpisodes: 28,
      currentSeason: 2,
      watchTimeSummary: "You watched ~11h over 9 days",
    });
    expect(view.celebration).toBeDefined();
    expect(view.celebration?.statLine).toContain("28 episodes");
    expect(view.celebration?.watchTimeLine).toBe("You watched ~11h over 9 days");
  });

  it("omits watch-time line when not provided", () => {
    const view = buildPostPlayView({
      title: "Show",
      episodeLabel: "S02 E12",
      postPlayState: { kind: "series-complete" },
      totalEpisodes: 28,
    });
    expect(view.celebration?.watchTimeLine).toBeUndefined();
  });
});

/**
 * Stopping 23 seconds into S01E03 of a ten-episode season reported
 * "3 / 10 · 30%" — true about the season, and not an answer to the question
 * the stopped-early screen asks, which is where you stopped. Films showed no
 * bar at all, because the season bar never applied to them.
 */
describe("stopped-early progress", () => {
  const stoppedEarly = {
    title: "Ozark",
    episodeLabel: "S01 E03",
    resumeLabel: "resume S01E03  ·  0:23",
    postPlayState: { kind: "mid-series" as const },
    totalEpisodes: 10,
    watchedEpisodes: 3,
  };

  it("reports position inside the episode, not progress through the season", () => {
    const view = buildPostPlayView({
      ...stoppedEarly,
      resumePositionSeconds: 23,
      episodeDurationSeconds: 2891,
    });

    expect(view.heroKind).toBe("stopped-early");
    expect(view.progressBar?.label).toBe("0:23 / 48:11");
    expect(view.progressBar?.percent).toBe(1);
    // The season numbers must not be what the bar reports.
    expect(view.progressBar?.label).not.toContain("3 / 10");
    expect(view.progressBar?.percent).not.toBe(30);
  });

  it("gives a film the same bar the season count could never provide", () => {
    const view = buildPostPlayView({
      ...stoppedEarly,
      titleType: "movie",
      totalEpisodes: undefined,
      watchedEpisodes: undefined,
      resumePositionSeconds: 1800,
      episodeDurationSeconds: 7200,
    });

    expect(view.progressBar?.label).toBe("30:00 / 2:00:00");
  });

  it("omits progress when the player reported no runtime", () => {
    const view = buildPostPlayView({ ...stoppedEarly, resumePositionSeconds: 23 });

    expect(view.progressBar).toBeUndefined();
  });

  it("never invents a denominator from a zero or negative runtime", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const view = buildPostPlayView({
        ...stoppedEarly,
        resumePositionSeconds: 23,
        episodeDurationSeconds: duration,
      });
      expect(view.progressBar).toBeUndefined();
    }
  });

  it("clamps a position past the runtime instead of exceeding 100%", () => {
    const view = buildPostPlayView({
      ...stoppedEarly,
      resumePositionSeconds: 5000,
      episodeDurationSeconds: 2891,
    });

    expect(view.progressBar?.percent).toBe(100);
  });
});
