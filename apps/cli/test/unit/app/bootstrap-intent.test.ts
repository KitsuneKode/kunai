import { describe, expect, test } from "bun:test";

import { resolveBootstrapIntent, type BootstrapArgs } from "@/app/bootstrap/bootstrap-intent";

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
    expect(intent.directTitle).toEqual({ id: "438631", type: "movie", name: "TMDB 438631" });
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
});
