import { afterAll, expect, test } from "bun:test";

import { DownloadJobsRepository } from "../src/index";
import { createTempStoreRegistry } from "./helpers/temp-store";

const stores = createTempStoreRegistry();

afterAll(() => {
  stores.cleanup();
});

function jobs(): DownloadJobsRepository {
  return new DownloadJobsRepository(stores.store("download-job-external-ids", "data"));
}

function enqueueInput(overrides: Partial<Parameters<DownloadJobsRepository["enqueue"]>[0]> = {}) {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    titleId: "tmdb:1339713",
    titleName: "Obsession",
    mediaKind: "movie",
    providerId: "videasy",
    mode: "series",
    streamUrl: "https://example.invalid/stream.m3u8",
    headers: {},
    outputPath: "/tmp/kunai/obsession.mp4",
    tempPath: "/tmp/kunai/obsession.mp4.tmp",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Parameters<DownloadJobsRepository["enqueue"]>[0];
}

test("a download job round-trips the external ids it was enqueued with", () => {
  const repo = jobs();

  repo.enqueue(enqueueInput({ externalIds: { tmdbId: "1339713", imdbId: "tt1234567" } }));

  expect(repo.get("job-1")?.externalIds).toEqual({ tmdbId: "1339713", imdbId: "tt1234567" });
});

test("a download job enqueued without external ids reads back undefined, not an empty bag", () => {
  const repo = jobs();

  repo.enqueue(enqueueInput());

  expect(repo.get("job-1")?.externalIds).toBeUndefined();
});

test("provider-native ids survive the round trip", () => {
  const repo = jobs();

  repo.enqueue(
    enqueueInput({
      titleId: "21",
      mediaKind: "anime",
      mode: "anime",
      providerId: "allmanga",
      externalIds: { malId: "21", providerNativeIds: { allmanga: "ReooPAxPMsHM4KPMY" } },
    }),
  );

  expect(repo.get("job-1")?.externalIds).toEqual({
    malId: "21",
    providerNativeIds: { allmanga: "ReooPAxPMsHM4KPMY" },
  });
});
