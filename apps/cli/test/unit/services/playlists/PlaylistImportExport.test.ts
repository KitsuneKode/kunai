import { expect, test } from "bun:test";

import { exportKunaiPlaylist, importKunaiPlaylist } from "@/services/playlists/KunaiPlaylistFormat";

test("kunai playlist export snapshots progress but never stream URLs", () => {
  const exported = exportKunaiPlaylist({
    playlist: { id: "playlist-1", name: "Weekend", createdAt: "2026-05-17T00:00:00.000Z" },
    items: [
      {
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 2,
        sortOrder: 0,
        providerHints: [{ providerId: "vidking", streamUrl: "https://must-not-leak.example" }],
        progressPercent: 25,
      },
    ],
  });

  expect(exported.format).toBe("kunai-playlist");
  expect(exported.items[0]?.progressPercent).toBe(25);
  expect(JSON.stringify(exported)).not.toContain("http");
});

test("kunai playlist import preserves unresolved items instead of guessing", () => {
  const imported = importKunaiPlaylist({
    format: "kunai-playlist",
    version: 1,
    exportedAt: "2026-05-17T00:00:00.000Z",
    playlist: { name: "Shared" },
    items: [
      {
        titleId: "unknown:1",
        mediaKind: "series",
        title: "Mystery",
        sortOrder: 0,
        providerHints: [],
      },
    ],
  });

  expect(imported.items[0]?.resolved).toBe(false);
  expect(imported.items[0]?.canAutoplay).toBe(false);
});
