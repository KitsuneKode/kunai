import { describe, expect, it } from "bun:test";

import { KEYBINDINGS, type KeyBinding } from "@/app-shell/keybindings";
import { buildPostPlayView } from "@/app-shell/post-play-view";

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

  it("uses the same player registry keys for mid-series session controls", () => {
    const bindings: readonly KeyBinding[] = KEYBINDINGS.map((binding) =>
      binding.id === "player-autoskip" ? { ...binding, chord: { input: "y" } } : binding,
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
