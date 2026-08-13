import { describe, expect, test } from "bun:test";

import { OfflineTitleIdentityService } from "@/services/offline/offline-title-identity";
import type { DownloadJobRecord } from "@kunai/storage";

function identity(aliases: Record<string, string> = {}) {
  const seen: string[] = [];
  const service = new OfflineTitleIdentityService({
    lookupTitleIdByAliasId: (id: string) => {
      seen.push(id);
      return aliases[id];
    },
  });
  return { service, seen };
}

function job(partial: Partial<DownloadJobRecord> = {}): DownloadJobRecord {
  return {
    id: "job-1",
    titleId: "1339713",
    titleName: "Obsession",
    mediaKind: "movie",
    providerId: "videasy",
    mode: "series",
    streamUrl: "",
    headers: {},
    status: "completed",
    progressPercent: 100,
    outputPath: "/tmp/x.mp4",
    tempPath: "/tmp/x.mp4.tmp",
    retryCount: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...partial,
  };
}

describe("OfflineTitleIdentityService.resolveForTitle", () => {
  test("uses the canonical id when the title carries enough to compute one", () => {
    const { service, seen } = identity();

    expect(
      service.resolveForTitle(
        { id: "1339713", type: "movie", externalIds: { tmdbId: "1339713" } },
        "series",
      ),
    ).toBe("tmdb:1339713");
    // No alias lookup is needed — the title answered for itself.
    expect(seen).toEqual([]);
  });

  test("upgrades a bare id through the alias index when the title carries no external ids", () => {
    // The download-time shape: the job was filed under "1339713" because
    // nothing richer was in hand, and history later learned the tmdb id.
    const { service, seen } = identity({ "1339713": "tmdb:1339713" });

    expect(service.resolveForTitle({ id: "1339713", type: "movie" }, "series")).toBe(
      "tmdb:1339713",
    );
    expect(seen).toEqual(["1339713"]);
  });

  test("keeps the raw id when nothing knows better", () => {
    const { service } = identity();

    expect(service.resolveForTitle({ id: "1339713", type: "movie" }, "series")).toBe("1339713");
  });

  test("resolves an opaque provider-native id through its provider alias", () => {
    const { service } = identity({ ReooPAxPMsHM4KPMY: "21" });

    expect(
      service.resolveForTitle({ id: "ReooPAxPMsHM4KPMY", type: "series", isAnime: true }, "anime"),
    ).toBe("21");
  });
});

describe("OfflineTitleIdentityService.resolveForJob", () => {
  test("a job and its title agree on one id", () => {
    const { service } = identity();
    const externalIds = { tmdbId: "1339713" };

    expect(service.resolveForJob(job({ externalIds }))).toBe(
      service.resolveForTitle({ id: "1339713", type: "movie", externalIds }, "series"),
    );
  });

  test("an anime job resolves in anime mode, not series mode", () => {
    const { service } = identity();

    expect(
      service.resolveForJob(
        job({ titleId: "x1", mediaKind: "anime", mode: "anime", externalIds: { malId: "21" } }),
      ),
    ).toBe("21");
  });

  test("a legacy job with no stored mode recovers it from the media kind", () => {
    const { service } = identity();

    expect(
      service.resolveForJob(
        job({
          titleId: "x1",
          mediaKind: "anime",
          mode: undefined,
          externalIds: { anilistId: "21" },
        }),
      ),
    ).toBe("21");
  });
});
