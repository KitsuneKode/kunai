// `--download` never reaches PlaybackPhase, so it never saw the catalog answer:
// `kunai -i 438631 -t movie --download` wrote "TMDB 438631" into the download
// job, the offline library, and the file name on disk. A healer can repair a
// database; it cannot rename a file the user already has.

import { describe, expect, test } from "bun:test";

import { resolvePlaceholderTitle } from "@/app/bootstrap/resolve-placeholder-title";
import type { TitleDetail } from "@/domain/catalog/title-detail";
import type { TitleInfo } from "@/domain/types";

const duneDetail: TitleDetail = {
  id: "438631",
  type: "movie",
  title: "Dune",
  year: "2021",
  artwork: { poster: "/dune.jpg" },
  externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
};

const placeholder: TitleInfo = { id: "438631", type: "movie", name: "TMDB 438631" };

describe("resolvePlaceholderTitle", () => {
  test("resolves a `-i/--id` placeholder into the real catalog title", async () => {
    const resolved = await resolvePlaceholderTitle(placeholder, {
      fetchDetail: async () => duneDetail,
    });

    expect(resolved.name).toBe("Dune");
    expect(resolved.posterUrl).toBe("https://image.tmdb.org/t/p/w500/dune.jpg");
    expect(resolved.externalIds).toEqual({ tmdbId: "438631", imdbId: "tt1160419" });
  });

  test("never fetches for a title that already has a real name", async () => {
    const searched: TitleInfo = { ...placeholder, name: "Dune" };
    const resolved = await resolvePlaceholderTitle(searched, {
      fetchDetail: async () => {
        throw new Error("must not fetch for a title that already has a name");
      },
    });

    expect(resolved).toBe(searched);
  });

  test("leaves the title untouched when the catalog is unreachable", async () => {
    const resolved = await resolvePlaceholderTitle(placeholder, {
      fetchDetail: async () => {
        throw new Error("network down");
      },
    });

    expect(resolved).toBe(placeholder);
  });

  test("does not fetch for an id no catalog can address", async () => {
    const opaque: TitleInfo = {
      id: "ReooPAxPMsHM4KPMY",
      type: "series",
      name: "ReooPAxPMsHM4KPMY",
    };
    const resolved = await resolvePlaceholderTitle(opaque, {
      fetchDetail: async () => {
        throw new Error("must not fetch an opaque provider id");
      },
    });

    expect(resolved).toBe(opaque);
  });

  test("asks the catalog with the title's own type and anime lane", async () => {
    const asked: { id: string; type: string; isAnime?: boolean }[] = [];
    await resolvePlaceholderTitle(
      { id: "anilist:21", type: "series", name: "anilist:21", isAnime: true },
      {
        fetchDetail: async (id, type, _signal, hints) => {
          asked.push({ id, type, isAnime: hints?.isAnime });
          return { id, type, title: "One Piece" };
        },
      },
    );

    expect(asked).toEqual([{ id: "anilist:21", type: "series", isAnime: true }]);
  });
});
