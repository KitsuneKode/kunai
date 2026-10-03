import { describe, expect, test } from "bun:test";

import { resolveBootstrapIntent, type BootstrapArgs } from "@/app/bootstrap/bootstrap-intent";
import { createInitialState, reduceState } from "@/domain/session/SessionState";

const baseState = () =>
  createInitialState("videasy", "allanime", {
    anime: { audio: "original", subtitle: "en" },
    series: { audio: "original", subtitle: "none" },
    movie: { audio: "original", subtitle: "en" },
  });

function args(overrides: Partial<BootstrapArgs> = {}): BootstrapArgs {
  return { anime: false, quick: false, ...overrides };
}

describe("resolveBootstrapIntent", () => {
  test("trims a search query and logs it", () => {
    const intent = resolveBootstrapIntent(args({ search: "  Dune  " }));
    expect(intent.query).toBe("Dune");
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toEqual([{ kind: "search", query: "Dune" }]);
  });

  test("treats a whitespace-only query as absent", () => {
    const intent = resolveBootstrapIntent(args({ search: "   " }));
    expect(intent.query).toBeUndefined();
    expect(intent.logs).toHaveLength(0);
  });

  test("builds a direct movie/series title from id + type", () => {
    const intent = resolveBootstrapIntent(args({ id: "438631", type: "movie" }));
    expect(intent.directTitle).toEqual({
      id: "438631",
      type: "movie",
      name: "TMDB 438631",
      externalIds: { tmdbId: "438631" },
    });
    expect(intent.logs).toEqual([{ kind: "direct-title", id: "438631", type: "movie" }]);
  });

  test("refuses direct id in anime mode and explains why", () => {
    const intent = resolveBootstrapIntent(args({ id: "21", anime: true }));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toEqual([{ kind: "anime-id-unsupported", id: "21" }]);
  });

  test("ignores a direct id with an unsupported or missing type", () => {
    expect(resolveBootstrapIntent(args({ id: "5", type: "person" })).logs).toEqual([
      { kind: "id-without-type", id: "5", type: "person" },
    ]);
    expect(resolveBootstrapIntent(args({ id: "5" })).directTitle).toBeNull();
  });

  test("honors an explicit --jump over quick mode", () => {
    expect(
      resolveBootstrapIntent(args({ search: "Dune", quick: true, jump: 3 }))
        .autoPickSearchResultIndex,
    ).toBe(3);
  });

  test("auto-picks the top result for quick mode with a query", () => {
    expect(
      resolveBootstrapIntent(args({ search: "Dune", quick: true })).autoPickSearchResultIndex,
    ).toBe(1);
  });

  test("does not auto-pick for quick mode without a query", () => {
    expect(resolveBootstrapIntent(args({ quick: true })).autoPickSearchResultIndex).toBeUndefined();
  });

  test("warns when -t arrives without -i", () => {
    const logs = resolveBootstrapIntent(args({ type: "movie" })).logs;
    expect(logs).toEqual([
      { kind: "flag-ignored", flag: "-t/--type", detail: "it only applies together with -i/--id" },
    ]);
  });

  test("warns when --jump arrives without -S", () => {
    const logs = resolveBootstrapIntent(args({ jump: 2 })).logs;
    expect(logs).toEqual([
      {
        kind: "flag-ignored",
        flag: "--jump",
        detail: "it only auto-picks from -S/--search results",
      },
    ]);
  });

  test("warns when -a and -y are both set (youtube wins)", () => {
    const logs = resolveBootstrapIntent(args({ anime: true, youtube: true })).logs;
    expect(logs).toEqual([
      {
        kind: "flag-ignored",
        flag: "-a/--anime",
        detail: "-y/--youtube selects the youtube mode, which wins the lane",
      },
    ]);
  });

  test("a youtube id under both lane flags resolves — the winning lane decides the conflict", () => {
    // Callers that bypass parseCliArgs can hand in both flags true; the
    // conflict check must judge the id against the lane that actually won,
    // not against a flag that already lost.
    const intent = resolveBootstrapIntent(args({ id: "youtube:abc", anime: true, youtube: true }));
    expect(intent.directTitle?.externalIds?.youtubeId).toBe("abc");
    expect(intent.logs.some((l) => l.kind === "id-lane-conflict")).toBe(false);
  });

  test("an anime-namespace id under both lane flags still conflicts with the winning lane", () => {
    const intent = resolveBootstrapIntent(args({ id: "anilist:21", anime: true, youtube: true }));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs.some((l) => l.kind === "id-lane-conflict" && l.lane === "youtube")).toBe(
      true,
    );
  });

  test("--jump is flagged when -i opens a title directly, even with -S present", () => {
    const logs = resolveBootstrapIntent(
      args({ search: "Dune", id: "438631", type: "movie", jump: 2 }),
    ).logs;
    expect(logs).toContainEqual({
      kind: "flag-ignored",
      flag: "--jump",
      detail: "-i/--id opens its title directly, so there is no result list to pick from",
    });
  });

  test("warns when -S is shadowed by a resolvable -i", () => {
    const logs = resolveBootstrapIntent(args({ search: "dune", id: "438631", type: "movie" })).logs;
    expect(logs).toContainEqual({
      kind: "flag-ignored",
      flag: "-S/--search",
      detail: "-i/--id opens its title directly, so the search never runs",
    });
  });

  test("warns when --download-path arrives without --download", () => {
    const logs = resolveBootstrapIntent(args({ downloadPath: "/tmp/x" })).logs;
    expect(logs).toEqual([
      {
        kind: "flag-ignored",
        flag: "--download-path",
        detail: "it only applies together with --download",
      },
    ]);
  });

  test("warns when -t rides a namespaced id that carries its own type", () => {
    const logs = resolveBootstrapIntent(args({ id: "anilist:21", type: "series" })).logs;
    expect(logs).toContainEqual({
      kind: "flag-ignored",
      flag: "-t/--type",
      detail: "anilist: ids carry their own content type",
    });
  });

  test("emits no orphan warnings for flags that all have readers", () => {
    const logs = resolveBootstrapIntent(args({ search: "dune", jump: 1, quick: true })).logs;
    expect(logs.some((entry) => entry.kind === "flag-ignored")).toBe(false);
  });
});

test("a resolved catalog detail replaces the -i placeholder name", () => {
  const placeholder = resolveBootstrapIntent(args({ id: "438631", type: "movie" })).directTitle;
  expect(placeholder?.name).toBe("TMDB 438631");

  const state = reduceState(
    { ...baseState(), currentTitle: placeholder },
    {
      type: "SET_TITLE_DETAIL",
      titleId: "438631",
      titleType: "movie",
      detail: { id: "438631", type: "movie", title: "Dune", year: "2021" },
    },
  );

  // The panel used to render "TMDB 438631" as the film's title while year,
  // runtime, score and synopsis beside it were all correct.
  expect(state.currentTitle?.name).toBe("Dune");
});

test("a real title name is never overwritten by a later detail fetch", () => {
  const state = reduceState(
    {
      ...baseState(),
      currentTitle: { id: "438631", type: "movie", name: "Dune: Part One" },
    },
    {
      type: "SET_TITLE_DETAIL",
      titleId: "438631",
      titleType: "movie",
      detail: { id: "438631", type: "movie", title: "Dune", year: "2021" },
    },
  );

  expect(state.currentTitle?.name).toBe("Dune: Part One");
});
