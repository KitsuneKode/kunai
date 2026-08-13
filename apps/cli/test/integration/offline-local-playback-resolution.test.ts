import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveLocalEpisodePlayback } from "@/app/playback/episode-playback-source";
import type { Container } from "@/container";
import type { TitleInfo } from "@/domain/types";
import type { ContinueSourcePreference } from "@/services/continuation/continuation-source";
import { OfflineTitleIdentityService } from "@/services/offline/offline-title-identity";
import { OfflineAssetService } from "@/services/offline/OfflineAssetService";
import { OfflineLibraryService } from "@/services/offline/OfflineLibraryService";
import {
  DownloadJobsRepository,
  HistoryTitleAliasRepository,
  OfflineAssetsRepository,
  openKunaiDatabase,
  runMigrations,
  type KunaiDatabase,
} from "@kunai/storage";
import type { MediaKind } from "@kunai/types";

/**
 * End-to-end cover for "a downloaded title will not play".
 *
 * The reported failure was a downloaded *movie* that bounced straight back to
 * the browse screen with no message. Every unit on the path passed in
 * isolation, so the regression only shows up when the real SQLite rows, the
 * real file on disk and the real selection engine are wired together — which is
 * what this does. Nothing here touches a provider or the network.
 */

type Harness = {
  readonly db: KunaiDatabase;
  readonly dir: string;
  readonly jobs: DownloadJobsRepository;
  readonly assets: OfflineAssetService;
  readonly aliases: HistoryTitleAliasRepository;
  readonly library: OfflineLibraryService;
  readonly filePath: string;
};

const dirs: string[] = [];
const openDatabases: KunaiDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
});

function createHarness(input: {
  readonly titleId: string;
  readonly mediaKind: MediaKind;
  readonly season?: number;
  readonly episode?: number;
}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "kunai-offline-playback-"));
  dirs.push(dir);
  const db = openKunaiDatabase(join(dir, "data.sqlite"));
  runMigrations(db, "data");
  openDatabases.push(db);

  // A real artifact: `resolveOfflineArtifactStatus` stats the path, so an
  // absent or zero-byte file would answer "missing" and mask the thing we test.
  const filePath = join(dir, "downloaded.mp4");
  writeFileSync(filePath, "not really video, but a real non-empty file");

  const jobs = new DownloadJobsRepository(db);
  const now = new Date().toISOString();
  const jobId = `job-${input.titleId}`;
  jobs.enqueue({
    id: jobId,
    titleId: input.titleId,
    titleName: "Obsession",
    mediaKind: input.mediaKind,
    season: input.season,
    episode: input.episode,
    providerId: "videasy",
    mode: "series",
    selectedQualityLabel: "best",
    streamUrl: "https://example.invalid/stream.m3u8",
    headers: {},
    outputPath: filePath,
    tempPath: `${filePath}.tmp`,
    createdAt: now,
    updatedAt: now,
  });
  jobs.complete(jobId, now);
  jobs.markArtifactValidated(jobId, "ready", now);

  // The real resolver, not a stub: identity is precisely what this suite is
  // here to pin down, and a passthrough would make every case pass trivially.
  const aliases = new HistoryTitleAliasRepository(db);
  const assets = new OfflineAssetService(
    new OfflineAssetsRepository(db),
    new OfflineTitleIdentityService(aliases),
  );
  const completed = jobs.get(jobId);
  if (!completed) throw new Error("download job missing after complete()");
  assets.adoptCompletedJob(completed);

  const library = new OfflineLibraryService({
    downloadService: { getJob: (id: string) => jobs.get(id) } as never,
    historyRepository: {
      upsertProgress: () => {},
      getLatestForTitleIdentity: () => undefined,
    } as never,
    offlineAssetService: assets,
  });

  return { db, dir, jobs, assets, aliases, library, filePath };
}

function containerFor(
  harness: Harness,
  options: {
    readonly mode?: "series" | "anime" | "youtube";
    readonly online?: boolean;
    readonly continueSourcePreference?: ContinueSourcePreference;
  } = {},
): Container {
  return {
    stateManager: { getState: () => ({ mode: options.mode ?? "series" }) },
    offlineAssetService: harness.assets,
    offlineTitleIdentity: new OfflineTitleIdentityService(harness.aliases),
    offlineLibraryService: harness.library,
    connectivity: { isOnline: () => options.online ?? false },
    config: { continueSourcePreference: options.continueSourcePreference ?? "auto" },
  } as unknown as Container;
}

const movieTitle: TitleInfo = {
  id: "1339713",
  type: "movie",
  name: "Obsession",
  launchSource: "offline-library",
};

describe("offline local playback resolution", () => {
  test("a downloaded movie resolves to its local file", async () => {
    // The reported bug. `applyDownloadJobSessionRouting` routes a movie whose
    // job carries mode "series" into series mode, so the session mode and the
    // title kind disagree — exactly the state the failing screenshot showed.
    const harness = createHarness({
      titleId: "1339713",
      mediaKind: "movie",
      season: 1,
      episode: 1,
    });

    const resolution = await resolveLocalEpisodePlayback(
      containerFor(harness),
      movieTitle,
      { season: 1, episode: 1 },
      { entrypoint: "offline-library", forceLocal: true },
    );

    expect(resolution).not.toBeNull();
    expect(resolution?.stream.url).toBe(harness.filePath);
    expect(resolution?.jobId).toBe("job-1339713");
    expect(resolution?.source.filePath).toBe(harness.filePath);
  });

  test("a downloaded episode resolves to its local file", async () => {
    const harness = createHarness({
      titleId: "61222",
      mediaKind: "series",
      season: 1,
      episode: 2,
    });

    const resolution = await resolveLocalEpisodePlayback(
      containerFor(harness),
      { id: "61222", type: "series", name: "Demo", launchSource: "offline-library" },
      { season: 1, episode: 2 },
      { entrypoint: "offline-library", forceLocal: true },
    );

    expect(resolution?.stream.url).toBe(harness.filePath);
  });

  test("an offline-library launch plays locally even when the user prefers streaming", async () => {
    // Guards the regression the branch fixed in the other direction: the
    // preference must not be able to veto a launch the user made *from* the
    // offline library, or pressing enter there silently does nothing.
    const harness = createHarness({
      titleId: "1339713",
      mediaKind: "movie",
      season: 1,
      episode: 1,
    });

    const resolution = await resolveLocalEpisodePlayback(
      containerFor(harness, { continueSourcePreference: "stream", online: true }),
      movieTitle,
      { season: 1, episode: 1 },
      { entrypoint: "offline-library", forceLocal: true },
    );

    expect(resolution?.stream.url).toBe(harness.filePath);
  });

  test("a continue launch honours a streaming preference and declines the local file", async () => {
    // The mirror of the case above: this is the online regression the branch
    // fixed, where every Continue-Watching resume silently preferred the
    // download and overrode `continueSourcePreference`.
    const harness = createHarness({
      titleId: "1339713",
      mediaKind: "movie",
      season: 1,
      episode: 1,
    });

    const resolution = await resolveLocalEpisodePlayback(
      containerFor(harness, { continueSourcePreference: "stream", online: true }),
      { ...movieTitle, launchSource: "continue" },
      { season: 1, episode: 1 },
      { entrypoint: "continue" },
    );

    expect(resolution).toBeNull();
  });

  test("a downloaded movie still resolves once its title carries external ids", async () => {
    // The write path stores `job.titleId` verbatim ("1339713"), but the read
    // path canonicalises, and `resolveCanonicalCatalogTitleId` rewrites any
    // movie/series carrying a tmdbId to "tmdb:<id>". A title enriched with
    // external ids therefore looked up an id no asset row has, the lookup
    // answered undefined, and the launch reported "Downloaded file
    // unavailable" for a file sitting healthy on disk.
    const harness = createHarness({
      titleId: "1339713",
      mediaKind: "movie",
      season: 1,
      episode: 1,
    });

    const resolution = await resolveLocalEpisodePlayback(
      containerFor(harness),
      { ...movieTitle, externalIds: { tmdbId: "1339713" } },
      { season: 1, episode: 1 },
      { entrypoint: "offline-library", forceLocal: true },
    );

    expect(resolution?.stream.url).toBe(harness.filePath);
  });

  test("a deleted artifact declines rather than handing back an unplayable path", async () => {
    // The library keeps advertising the title as downloaded from its SQLite
    // row, so the file check is the only thing standing between the user and a
    // silent bounce back to the browse screen.
    const harness = createHarness({
      titleId: "1339713",
      mediaKind: "movie",
      season: 1,
      episode: 1,
    });
    rmSync(harness.filePath, { force: true });

    const resolution = await resolveLocalEpisodePlayback(
      containerFor(harness),
      movieTitle,
      { season: 1, episode: 1 },
      { entrypoint: "offline-library", forceLocal: true },
    );

    expect(resolution).toBeNull();
  });
});
