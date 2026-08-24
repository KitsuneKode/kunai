// Repair path for rows written before the `-i/--id` lane learned to adopt the
// catalog answer: their title is the id wearing a name ("TMDB 438631"), so the
// text-search resolver can never find them. Resolving by id instead is exact.

import { describe, expect, it } from "bun:test";

import type { TitleDetail } from "@/domain/catalog/title-detail";
import { createHistoryMetadataResolver } from "@/services/history-metadata/create-history-metadata-resolver";
import { HistoryMetadataHealer } from "@/services/history-metadata/HistoryMetadataHealer";
import { selectHistoryHealTargets } from "@/services/history-metadata/select-heal-targets";
import type { HistoryProgress } from "@kunai/storage";

function entry(over: Partial<HistoryProgress> & { titleId: string }): HistoryProgress {
  return {
    key: `${over.titleId}:none`,
    mediaKind: over.mediaKind ?? "movie",
    title: over.title ?? over.titleId,
    positionSeconds: 15,
    completed: false,
    updatedAt: over.updatedAt ?? "2026-08-23T09:14:38.107Z",
    createdAt: "2026-08-23T09:14:35.408Z",
    ...over,
  } as HistoryProgress;
}

const duneDetail: TitleDetail = {
  id: "438631",
  type: "movie",
  title: "Dune",
  artwork: { poster: "/dune.jpg" },
  externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
};

describe("selectHistoryHealTargets — placeholder titles", () => {
  it("flags a row whose title is the `-i` placeholder", () => {
    const targets = selectHistoryHealTargets([entry({ titleId: "438631", title: "TMDB 438631" })]);
    expect(targets[0]?.needsTitle).toBe(true);
  });

  it("flags a row named after its own id", () => {
    const targets = selectHistoryHealTargets([
      entry({ titleId: "tmdb:438631", title: "tmdb:438631" }),
    ]);
    expect(targets[0]?.needsTitle).toBe(true);
  });

  it("selects a placeholder row even when poster and ids are already present", () => {
    const targets = selectHistoryHealTargets([
      entry({
        titleId: "438631",
        title: "TMDB 438631",
        posterUrl: "https://img/x.jpg",
        externalIds: { tmdbId: "438631" },
      }),
    ]);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.needsTitle).toBe(true);
  });

  it("does not flag a placeholder over an opaque provider id — nothing could resolve it", () => {
    const targets = selectHistoryHealTargets([
      entry({
        titleId: "ReooPAxPMsHM4KPMY",
        title: "ReooPAxPMsHM4KPMY",
        mediaKind: "anime",
        posterUrl: "https://img/x.jpg",
        externalIds: { anilistId: "1" },
      }),
    ]);
    expect(targets).toHaveLength(0);
  });

  it("leaves a real title alone", () => {
    const targets = selectHistoryHealTargets([
      entry({ titleId: "438631", title: "Dune", posterUrl: "https://img/x.jpg" }),
    ]);
    expect(targets[0]?.needsTitle).toBe(false);
  });
});

describe("createHistoryMetadataResolver — placeholder titles", () => {
  it("resolves a placeholder row by id and returns the real title", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => {
        throw new Error("must not text-search a placeholder title");
      },
      fetchDetail: async (titleId) => (titleId === "438631" ? duneDetail : null),
    });

    const resolved = await resolver.resolve({
      titleId: "438631",
      title: "TMDB 438631",
      mediaKind: "movie",
      needsPoster: true,
      needsExternalIds: true,
      needsProviderNativeMapping: false,
      needsTitle: true,
    });

    expect(resolved).toEqual({
      title: "Dune",
      posterUrl: "https://image.tmdb.org/t/p/w500/dune.jpg",
      externalIds: { tmdbId: "438631", imdbId: "tt1160419" },
    });
  });

  it("returns nothing rather than guessing when the catalog has no answer", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => {
        throw new Error("must not text-search a placeholder title");
      },
      fetchDetail: async () => null,
    });

    const resolved = await resolver.resolve({
      titleId: "438631",
      title: "TMDB 438631",
      mediaKind: "movie",
      needsPoster: true,
      needsExternalIds: true,
      needsProviderNativeMapping: false,
      needsTitle: true,
    });

    expect(resolved).toBeNull();
  });

  it("refuses a detail whose own title is still a placeholder", async () => {
    const resolver = createHistoryMetadataResolver({
      search: async () => [],
      fetchDetail: async () => ({ id: "438631", type: "movie", title: "TMDB 438631" }),
    });

    const resolved = await resolver.resolve({
      titleId: "438631",
      title: "TMDB 438631",
      mediaKind: "movie",
      needsPoster: true,
      needsExternalIds: true,
      needsProviderNativeMapping: false,
      needsTitle: true,
    });

    expect(resolved).toBeNull();
  });

  it("still text-searches a row that has a real title", async () => {
    let searched = "";
    const resolver = createHistoryMetadataResolver({
      search: async (title) => {
        searched = title;
        return [];
      },
      fetchDetail: async () => {
        throw new Error("must not fetch detail for a real title");
      },
    });

    await resolver.resolve({
      titleId: "opaque-1",
      title: "Barakamon",
      mediaKind: "movie",
      needsPoster: true,
      needsExternalIds: true,
      needsProviderNativeMapping: false,
      needsTitle: false,
    });

    expect(searched).toBe("Barakamon");
  });
});

describe("HistoryMetadataHealer — placeholder titles", () => {
  it("backfills the resolved title onto the row", async () => {
    const backfilled: { titleId: string; title?: string }[] = [];
    const healer = new HistoryMetadataHealer({
      resolver: {
        resolve: async () => ({
          title: "Dune",
          posterUrl: "https://img/dune.jpg",
          externalIds: { tmdbId: "438631" },
        }),
      },
      repo: {
        backfillTitleMetadata: (titleId, metadata) => {
          backfilled.push({ titleId, title: metadata.title });
        },
      },
    });

    const healed = await healer.heal([entry({ titleId: "438631", title: "TMDB 438631" })]);

    expect(backfilled).toEqual([{ titleId: "438631", title: "Dune" }]);
    expect(healed.map((h) => h.titleId)).toEqual(["438631"]);
  });
});
