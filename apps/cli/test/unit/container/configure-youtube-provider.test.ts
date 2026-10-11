import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyYoutubeProviderConfig } from "@/container/configure-youtube-provider";
import type { KitsuneConfig } from "@/services/persistence/ConfigService";
import { configureYoutubeProvider, getYoutubeProviderConfig } from "@kunai/providers/youtube";
import { openKunaiDatabase, runMigrations } from "@kunai/storage";

let tempDir: string;
let db: ReturnType<typeof openKunaiDatabase>;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kunai-configure-youtube-"));
  db = openKunaiDatabase(join(tempDir, "cache.sqlite"));
  runMigrations(db, "cache");
});

afterEach(() => {
  configureYoutubeProvider({});
  // Close before removing: Windows refuses to delete a file with an open handle.
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("every YouTube credential reaches the provider, the PO token included", () => {
  // The middle link of the chain that was broken end to end: the token was accepted
  // by settings and persisted by config, but nothing carried it to the provider, so
  // playback and downloads both ran without it.
  applyYoutubeProviderConfig(
    {
      youtubeMetadata: {
        instanceUrl: "https://inv.example",
        cookiesFromBrowser: "firefox",
        cookiesFile: "/tmp/cookies.txt",
        extractorArgs: "youtube:player_client=visionos",
        poToken: "visionos.gvs+SECRET",
        sponsorblockRemove: "sponsor",
      },
    } as Pick<KitsuneConfig, "youtubeMetadata">,
    db,
  );

  const applied = getYoutubeProviderConfig();
  expect(applied.poToken).toBe("visionos.gvs+SECRET");
  expect(applied.extractorArgs).toBe("youtube:player_client=visionos");
  expect(applied.cookiesFromBrowser).toBe("firefox");
  expect(applied.cookiesFile).toBe("/tmp/cookies.txt");
  expect(applied.sponsorblockRemove).toBe("sponsor");
});

test("an unset PO token stays unset rather than becoming an empty string", () => {
  applyYoutubeProviderConfig(
    {
      youtubeMetadata: { extractorArgs: "youtube:player_client=visionos" },
    } as Pick<KitsuneConfig, "youtubeMetadata">,
    db,
  );

  expect(getYoutubeProviderConfig().poToken).toBeUndefined();
});

test("purges cached metadata on startup when YouTube config has drifted", () => {
  const initialConfig = {
    youtubeMetadata: { cookiesFromBrowser: "chrome" },
  } as Pick<KitsuneConfig, "youtubeMetadata">;

  applyYoutubeProviderConfig(initialConfig, db);

  // Insert a cached metadata row
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO youtube_metadata_cache (video_id, payload_json, source, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("vid123", JSON.stringify({ id: "vid123" }), "yt-dlp", now, "2099-01-01T00:00:00.000Z");

  expect(db.query("SELECT COUNT(*) as count FROM youtube_metadata_cache").get()).toEqual({
    count: 1,
  });

  // Re-running with identical config preserves cache
  applyYoutubeProviderConfig(initialConfig, db);
  expect(db.query("SELECT COUNT(*) as count FROM youtube_metadata_cache").get()).toEqual({
    count: 1,
  });

  // Re-running with drifted config purges cache
  const driftedConfig = {
    youtubeMetadata: { cookiesFromBrowser: "firefox" },
  } as Pick<KitsuneConfig, "youtubeMetadata">;

  applyYoutubeProviderConfig(driftedConfig, db);
  expect(db.query("SELECT COUNT(*) as count FROM youtube_metadata_cache").get()).toEqual({
    count: 0,
  });
});
