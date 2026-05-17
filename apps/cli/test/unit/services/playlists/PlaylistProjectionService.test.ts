import { expect, test } from "bun:test";

import { projectPlaylistItems } from "@/services/playlists/PlaylistProjectionService";

test("playlist projection joins progress from history without copying it into storage", () => {
  const projected = projectPlaylistItems({
    items: [
      {
        id: "item-1",
        playlistId: "playlist-1",
        titleId: "tmdb:1",
        mediaKind: "series",
        title: "Example",
        season: 1,
        episode: 2,
        sortOrder: 0,
        addedAt: "2026-05-17T00:00:00.000Z",
      },
    ],
    progress: [
      {
        titleId: "tmdb:1",
        mediaKind: "series",
        season: 1,
        episode: 2,
        positionSeconds: 300,
        durationSeconds: 1200,
        completed: false,
      },
    ],
  });

  expect(projected[0]?.progressPercent).toBe(25);
  expect("positionSeconds" in (projected[0] ?? {})).toBe(false);
});
