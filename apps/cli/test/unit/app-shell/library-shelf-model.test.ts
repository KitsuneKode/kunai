import { describe, expect, test } from "bun:test";

import {
  buildLibraryShelfSections,
  type LibraryShelfSection,
} from "@/app-shell/library-shelf-model";
import type { OfflineLibraryShelfGroup } from "@/domain/offline/OfflineLibraryEngine";
import type { HistoryProgress } from "@/services/storage/storage-read-models";

function group(
  patch: Partial<OfflineLibraryShelfGroup> &
    Pick<OfflineLibraryShelfGroup, "titleId" | "titleName" | "readyCount" | "issueCount">,
): OfflineLibraryShelfGroup {
  return {
    key: `key-${patch.titleId}`,
    label: patch.titleName,
    detail: "detail",
    actionSummary: "actions",
    artifactSummary: "artifacts",
    entries: [],
    ...patch,
  };
}

function history(
  patch: Partial<HistoryProgress> & Pick<HistoryProgress, "titleId">,
): HistoryProgress {
  const updatedAt = patch.updatedAt ?? "2026-05-17T00:00:00.000Z";
  return {
    key: `hist-${patch.titleId}`,
    title: patch.titleId,
    mediaKind: "series",
    season: 1,
    episode: 1,
    positionSeconds: 0,
    durationSeconds: 1200,
    completed: false,
    providerId: "vidking",
    createdAt: updatedAt,
    ...patch,
    updatedAt,
  };
}

function sectionIds(sections: readonly LibraryShelfSection[]): string[] {
  return sections.map((section) => section.id);
}

describe("library shelf model — offline-only sections", () => {
  test("empty offline groups produce no Watchlist rows", () => {
    expect(buildLibraryShelfSections({ groups: [], historyByTitle: {} })).toEqual([]);
  });

  test("broken artifacts remain in Needs attention", () => {
    const BROKEN_GROUP = group({
      titleId: "t-broken",
      titleName: "Broken Title",
      readyCount: 0,
      issueCount: 1,
    });
    expect(
      buildLibraryShelfSections({ groups: [BROKEN_GROUP], historyByTitle: {} })[0],
    ).toMatchObject({ id: "needs-attention" });
  });

  test("ready downloads land in Downloaded without a Saved/Watchlist section", () => {
    const ready = group({
      titleId: "t-ready",
      titleName: "Ready Title",
      readyCount: 2,
      issueCount: 0,
    });
    const sections = buildLibraryShelfSections({ groups: [ready], historyByTitle: {} });
    expect(sectionIds(sections)).toEqual(["downloaded"]);
    expect(sections[0]?.rows).toEqual([{ kind: "offline", group: ready }]);
  });

  test("in-progress history buckets ahead of ready downloads", () => {
    const watching = group({
      titleId: "t-watching",
      titleName: "Watching",
      readyCount: 1,
      issueCount: 0,
    });
    const sections = buildLibraryShelfSections({
      groups: [watching],
      historyByTitle: {
        "t-watching": history({
          titleId: "t-watching",
          positionSeconds: 400,
          durationSeconds: 1000,
          completed: false,
        }),
      },
    });
    expect(sectionIds(sections)).toEqual(["in-progress"]);
  });

  test("mixed shelf keeps offline-only section order and omits Watchlist", () => {
    const watching = group({
      titleId: "t-watching",
      titleName: "Watching",
      readyCount: 1,
      issueCount: 0,
    });
    const ready = group({
      titleId: "t-ready",
      titleName: "Ready",
      readyCount: 3,
      issueCount: 1,
    });
    const broken = group({
      titleId: "t-broken",
      titleName: "Broken",
      readyCount: 0,
      issueCount: 2,
    });
    const sections = buildLibraryShelfSections({
      groups: [broken, ready, watching],
      historyByTitle: {
        "t-watching": history({
          titleId: "t-watching",
          positionSeconds: 500,
          durationSeconds: 1000,
          completed: false,
        }),
      },
    });
    expect(sectionIds(sections)).toEqual(["in-progress", "downloaded", "needs-attention"]);
    expect(sections.every((section) => section.rows.every((row) => row.kind === "offline"))).toBe(
      true,
    );
  });
});
