import { describe, expect, test } from "bun:test";

import {
  directIdImpliedLane,
  resolveBootstrapIntent,
  resolveLaunchMode,
} from "@/app/bootstrap/bootstrap-intent";
import { parseCliArgs } from "@/cli-args";

function parse(argv: string[]) {
  return parseCliArgs(argv);
}

/**
 * `-i` took a bare TMDB id only; a namespaced id like `anilist:21` was parsed
 * then dropped — the provider layer keyed on a TMDB shape the id did not have.
 * Namespaced ids now reuse the share-link `cat=ns:id` vocabulary and carry
 * `externalIds`, and the anime/youtube namespaces imply their lane.
 */
describe("namespaced -i/--id", () => {
  test("anilist:<id> produces an anime title with an anilist externalId", () => {
    const intent = resolveBootstrapIntent(parse(["-i", "anilist:21"]));
    const title = intent.directTitle;
    expect(title?.id).toBe("anilist:21");
    expect(title?.type).toBe("series");
    expect(title?.isAnime).toBe(true);
    expect(title?.externalIds?.anilistId).toBe("21");
    expect(intent.logs).toContainEqual({ kind: "direct-title", id: "anilist:21", type: "series" });
  });

  test("mal:<id> maps to malId and implies the anime lane without -a", () => {
    const intent = resolveBootstrapIntent(parse(["-i", "mal:34034"]));
    expect(intent.directTitle?.externalIds?.malId).toBe("34034");
    expect(intent.directTitle?.isAnime).toBe(true);
    expect(resolveLaunchMode(parse(["-i", "mal:34034"]))).toBe("anime");
  });

  test("anilist:<id> under -a is no longer the anime-id-unsupported dead end", () => {
    const intent = resolveBootstrapIntent(parse(["-a", "-i", "anilist:21"]));
    expect(intent.directTitle?.externalIds?.anilistId).toBe("21");
    expect(intent.logs.some((l) => l.kind === "anime-id-unsupported")).toBe(false);
  });

  test("a bare anime-lane id still warns it is unsupported", () => {
    const intent = resolveBootstrapIntent(parse(["-a", "-i", "438631"]));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toContainEqual({ kind: "anime-id-unsupported", id: "438631" });
  });

  test("tmdb:<id> still needs -t and carries the tmdbId externalId", () => {
    const missing = resolveBootstrapIntent(parse(["-i", "tmdb:1396"]));
    expect(missing.directTitle).toBeNull();
    expect(missing.logs.some((l) => l.kind === "id-without-type")).toBe(true);

    const intent = resolveBootstrapIntent(parse(["-i", "tmdb:1396", "-t", "tv"]));
    expect(intent.directTitle?.externalIds?.tmdbId).toBe("1396");
    expect(intent.directTitle?.type).toBe("series");
  });

  test("imdb:<id> rejects as an unknown namespace until imdb→tmdb resolution exists", () => {
    const intent = resolveBootstrapIntent(parse(["-i", "imdb:0944947", "-t", "tv"]));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toContainEqual({ kind: "id-unknown-namespace", id: "imdb:0944947" });
  });

  test("youtube:<id> implies the youtube lane and picks video vs playlist", () => {
    const video = resolveBootstrapIntent(parse(["-i", "youtube:dQw4w9WgXcQ"]));
    expect(video.directTitle?.externalIds?.youtubeId).toBe("dQw4w9WgXcQ");
    expect(resolveLaunchMode(parse(["-i", "youtube:dQw4w9WgXcQ"]))).toBe("youtube");

    const playlist = resolveBootstrapIntent(parse(["-i", "youtube:PLxxxxxxxxxxxxxx"]));
    expect(playlist.directTitle?.externalIds?.youtubePlaylistId).toBe("PLxxxxxxxxxxxxxx");
  });

  test("an unknown namespace warns instead of silently dropping the id", () => {
    const intent = resolveBootstrapIntent(parse(["-i", "crunchyroll:123"]));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toContainEqual({ kind: "id-unknown-namespace", id: "crunchyroll:123" });
  });

  test("an anime-namespace id with -y warns about the lane conflict", () => {
    const intent = resolveBootstrapIntent(parse(["-y", "-i", "anilist:21"]));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toContainEqual({
      kind: "id-lane-conflict",
      id: "anilist:21",
      namespace: "anilist",
      lane: "youtube",
    });
    // The explicit flag still wins the lane — the id, not the flag, is ignored.
    expect(resolveLaunchMode(parse(["-y", "-i", "anilist:21"]))).toBe("youtube");
  });

  test("a youtube id with -a warns about the lane conflict", () => {
    const intent = resolveBootstrapIntent(parse(["-a", "-i", "youtube:dQw4w9WgXcQ"]));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs.some((l) => l.kind === "id-lane-conflict" && l.lane === "anime")).toBe(true);
  });
});

describe("bare -i back-compat", () => {
  test("a bare id with -t behaves exactly as before, plus a tmdbId externalId", () => {
    const intent = resolveBootstrapIntent(parse(["-i", "438631", "-t", "movie"]));
    expect(intent.directTitle?.id).toBe("438631");
    expect(intent.directTitle?.type).toBe("movie");
    expect(intent.directTitle?.externalIds?.tmdbId).toBe("438631");
    expect(intent.directTitle?.isAnime).toBeUndefined();
  });

  test("a bare id without -t is still rejected with id-without-type", () => {
    const intent = resolveBootstrapIntent(parse(["-i", "438631"]));
    expect(intent.directTitle).toBeNull();
    expect(intent.logs).toContainEqual({ kind: "id-without-type", id: "438631", type: undefined });
  });
});

describe("directIdImpliedLane", () => {
  test.each([
    ["anilist:21", "anime"],
    ["mal:34034", "anime"],
    ["youtube:abc", "youtube"],
  ] as const)("%s implies %s", (id, lane) => {
    expect(directIdImpliedLane(id)).toBe(lane);
  });

  test.each(["438631", "tmdb:1396", "imdb:tt0944947", "bogus:1", undefined] as const)(
    "%s implies no lane",
    (id) => {
      expect(directIdImpliedLane(id)).toBeUndefined();
    },
  );
});
