import { expect, test } from "bun:test";

import { DurablePlaylistService } from "@/services/playlists/DurablePlaylistService";
import { openKunaiDatabase, PlaylistsRepository, runMigrations } from "@kunai/storage";

test("DurablePlaylistService creates playlists and exports safe documents", () => {
  const db = openKunaiDatabase(":memory:");
  runMigrations(db, "data");
  const service = new DurablePlaylistService(new PlaylistsRepository(db), {
    now: () => "2026-05-17T00:00:00.000Z",
    id: (prefix) => `${prefix}-1`,
  });

  const playlist = service.createPlaylist("Weekend");
  service.addItem(playlist.id, {
    titleId: "tmdb:1",
    mediaKind: "series",
    title: "Example",
    season: 1,
    episode: 2,
    providerHints: [{ providerId: "vidking", streamUrl: "https://must-not-leak.example" }],
  });

  const exported = service.exportPlaylist(playlist.id, "Weekend", []);

  expect(exported.items).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain("http");

  db.close();
});
