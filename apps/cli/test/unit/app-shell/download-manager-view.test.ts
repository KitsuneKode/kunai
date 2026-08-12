import { describe, expect, test } from "bun:test";

import {
  buildDownloadManagerLayout,
  buildDownloadManagerRailModel,
  DOWNLOAD_MANAGER_RAIL_GAP,
} from "@/app-shell/download-manager-view";
import type { DownloadJobRecord } from "@/services/storage/storage-read-models";

function job(patch: Partial<DownloadJobRecord> & Pick<DownloadJobRecord, "id">): DownloadJobRecord {
  return {
    titleId: "t",
    titleName: "Demo",
    mediaKind: "series",
    providerId: "vidking",
    streamUrl: "https://x",
    headers: {},
    status: "queued",
    progressPercent: 0,
    outputPath: "/downloads/demo.mp4",
    tempPath: "/downloads/demo.tmp",
    retryCount: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...patch,
  };
}

describe("buildDownloadManagerLayout", () => {
  test.each([
    [72, false, 72],
    [100, false, 100],
    [140, true, 106],
  ] as const)("download layout at %d columns", (columns, showRail, expectedListWidth) => {
    const layout = buildDownloadManagerLayout(columns);
    expect(layout.showRail).toBe(showRail);
    expect(layout.listWidth).toBe(expectedListWidth);
    expect(
      layout.listWidth + (layout.showRail ? layout.railWidth + DOWNLOAD_MANAGER_RAIL_GAP : 0),
    ).toBe(columns);
  });

  test("narrow layouts give every column to the list", () => {
    const layout = buildDownloadManagerLayout(72);
    expect(layout.railWidth).toBe(0);
    expect(layout.columns).toBe(72);
  });

  test("the rail appears exactly at the documented width threshold", () => {
    expect(buildDownloadManagerLayout(123).showRail).toBe(false);
    expect(buildDownloadManagerLayout(124).showRail).toBe(true);
  });

  test("a degenerate width still yields a usable, non-negative list", () => {
    const layout = buildDownloadManagerLayout(0);
    expect(layout.showRail).toBe(false);
    expect(layout.listWidth).toBeGreaterThan(0);
  });
});

describe("buildDownloadManagerRailModel", () => {
  test("returns null when no job is selected", () => {
    expect(buildDownloadManagerRailModel(undefined, "none")).toBeNull();
  });

  test("uses canonical presentation and title-owned artwork", () => {
    const model = buildDownloadManagerRailModel(
      job({
        id: "1",
        titleName: "Severance",
        mediaKind: "series",
        season: 1,
        episode: 3,
        status: "running",
        progressPercent: 42,
        posterUrl: "https://img.example/severance.jpg",
      }),
      "ready",
    );

    expect(model).toMatchObject({
      title: "Severance",
      subtitle: "S01E03",
      posterUrl: "https://img.example/severance.jpg",
      posterState: "ready",
    });
    const facts = new Map(model?.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.get("Status")).toContain("downloading");
    expect(facts.get("Progress")).toBe("42%");
  });

  test("a legacy synthetic movie row reads as Movie, never S01E01", () => {
    const model = buildDownloadManagerRailModel(
      job({
        id: "1",
        titleName: "Dune: Part Two",
        mediaKind: "movie",
        season: 1,
        episode: 1,
      }),
      "none",
    );

    expect(model?.subtitle).toBe("Movie");
    expect(JSON.stringify(model)).not.toContain("S01E01");
  });

  test("anime is episode-only by default", () => {
    expect(
      buildDownloadManagerRailModel(
        job({ id: "1", titleName: "Frieren", mediaKind: "anime", season: 1, episode: 3 }),
        "none",
      )?.subtitle,
    ).toBe("E03");
  });

  test("carries the required poster state through unchanged", () => {
    expect(
      buildDownloadManagerRailModel(job({ id: "1", posterUrl: "https://x/p.jpg" }), "pending")
        ?.posterState,
    ).toBe("pending");
  });

  test("a failed job surfaces its failure as a fact", () => {
    const model = buildDownloadManagerRailModel(
      job({ id: "1", status: "failed", errorMessage: "source gone" }),
      "none",
    );
    const facts = new Map(model?.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.get("Status")).toContain("failed");
  });
});
