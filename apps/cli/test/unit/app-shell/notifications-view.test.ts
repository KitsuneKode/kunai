import { describe, expect, it } from "bun:test";

import {
  buildNotificationsView,
  cycleNotificationsSortMode,
  getDefaultNotificationsSortMode,
  nearestNotificationDedupKey,
  NOTIFICATION_SORT_MODES_BY_TAB,
  type BuildNotificationsViewInput,
} from "@/app-shell/notifications-view";
import type { NotificationRecord } from "@kunai/storage";

const rec = (over: Partial<NotificationRecord>): NotificationRecord => ({
  id: over.dedupKey ?? "id",
  dedupKey: "k",
  kind: "new-episode",
  title: "Frieren S1E13 available",
  body: "available on allanime",
  actionJson: JSON.stringify(["queue-next", "queue-end", "dismiss"]),
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  ...over,
});

const view = (over: Partial<BuildNotificationsViewInput>) =>
  buildNotificationsView({
    records: [],
    tab: "active",
    sortMode: "attention",
    page: 0,
    pageSize: 10,
    selectedDedupKey: null,
    now: "2026-07-16T12:00:00.000Z",
    ...over,
  });

describe("notifications sort modes", () => {
  it("declares per-tab modes and defaults", () => {
    expect(NOTIFICATION_SORT_MODES_BY_TAB.active).toEqual(["attention", "newest", "type"]);
    expect(NOTIFICATION_SORT_MODES_BY_TAB.archive).toEqual(["newest", "type"]);
    expect(getDefaultNotificationsSortMode("active")).toBe("attention");
    expect(getDefaultNotificationsSortMode("archive")).toBe("newest");
  });

  it("cycles modes per tab", () => {
    expect(cycleNotificationsSortMode("active", "attention")).toBe("newest");
    expect(cycleNotificationsSortMode("active", "newest")).toBe("type");
    expect(cycleNotificationsSortMode("active", "type")).toBe("attention");
    expect(cycleNotificationsSortMode("archive", "newest")).toBe("type");
    expect(cycleNotificationsSortMode("archive", "type")).toBe("newest");
  });
});

describe("buildNotificationsView ordering", () => {
  it("orders Attention by tier then recency", () => {
    const records = [
      rec({
        dedupKey: "read-old",
        readAt: "2026-07-16T05:00:00.000Z",
        updatedAt: "2026-07-16T04:00:00.000Z",
      }),
      rec({ dedupKey: "unread-action-old", updatedAt: "2026-07-16T05:00:00.000Z" }),
      rec({
        dedupKey: "read-new",
        readAt: "2026-07-16T09:00:00.000Z",
        updatedAt: "2026-07-16T08:00:00.000Z",
      }),
      rec({
        dedupKey: "unread-dismiss-new",
        actionJson: JSON.stringify(["dismiss"]),
        updatedAt: "2026-07-16T09:00:00.000Z",
      }),
      rec({ dedupKey: "unread-action-new", updatedAt: "2026-07-16T10:00:00.000Z" }),
    ];

    expect(view({ records, sortMode: "attention" }).orderedDedupKeys).toEqual([
      "unread-action-new",
      "unread-action-old",
      "unread-dismiss-new",
      "read-new",
      "read-old",
    ]);
  });

  it("orders Newest strictly by recency", () => {
    const records = [
      rec({ dedupKey: "middle", updatedAt: "2026-07-16T05:00:00.000Z" }),
      rec({ dedupKey: "oldest", updatedAt: "2026-07-16T04:00:00.000Z" }),
      rec({ dedupKey: "newest", updatedAt: "2026-07-16T06:00:00.000Z" }),
    ];

    expect(view({ records, sortMode: "newest" }).orderedDedupKeys).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("orders Type by attention group before recency", () => {
    const records = [
      rec({
        dedupKey: "download-complete",
        kind: "download-complete",
        updatedAt: "2026-07-16T10:00:00.000Z",
      }),
      rec({ dedupKey: "future-kind", kind: "future-kind", updatedAt: "2026-07-16T09:00:00.000Z" }),
      rec({
        dedupKey: "app-update",
        kind: "app-update",
        actionJson: JSON.stringify(["update-app", "dismiss"]),
        updatedAt: "2026-07-16T08:00:00.000Z",
      }),
      rec({ dedupKey: "new-episode", kind: "new-episode", updatedAt: "2026-07-16T07:00:00.000Z" }),
      rec({
        dedupKey: "download-failed",
        kind: "download-failed",
        actionJson: JSON.stringify(["retry-download", "dismiss"]),
        updatedAt: "2026-07-16T05:00:00.000Z",
      }),
      rec({
        dedupKey: "queue-recovery",
        kind: "queue-recovery",
        actionJson: JSON.stringify(["restore-queue", "dismiss"]),
        updatedAt: "2026-07-16T06:00:00.000Z",
      }),
    ];

    expect(view({ records, sortMode: "type" }).orderedDedupKeys).toEqual([
      "queue-recovery",
      "download-failed",
      "new-episode",
      "app-update",
      "download-complete",
      "future-kind",
    ]);
  });

  it("breaks equal timestamps by ascending dedupKey", () => {
    const records = [
      rec({ dedupKey: "b", updatedAt: "2026-07-16T05:00:00.000Z" }),
      rec({ dedupKey: "a", updatedAt: "2026-07-16T05:00:00.000Z" }),
    ];

    expect(view({ records, sortMode: "newest" }).orderedDedupKeys).toEqual(["a", "b"]);
  });
});

describe("buildNotificationsView pagination and selection", () => {
  const fiveRecords = () =>
    Array.from({ length: 5 }, (_, i) =>
      rec({ dedupKey: `k${i}`, updatedAt: `2026-07-16T0${5 - i}:00:00.000Z` }),
    );

  it("sorts before paginating", () => {
    const paged = view({ records: fiveRecords(), sortMode: "newest", page: 1, pageSize: 2 });

    expect(paged.orderedDedupKeys).toEqual(["k0", "k1", "k2", "k3", "k4"]);
    expect(paged.rows.map((row) => row.dedupKey)).toEqual(["k2", "k3"]);
    expect(paged.totalPages).toBe(3);
    expect(paged.page).toBe(1);
  });

  it("derives the page containing the selected dedupKey", () => {
    const selected = view({
      records: fiveRecords(),
      sortMode: "newest",
      page: 0,
      pageSize: 2,
      selectedDedupKey: "k4",
    });

    expect(selected.page).toBe(2);
    expect(selected.selectedIndex).toBe(0);
    expect(selected.selectedRow?.dedupKey).toBe("k4");
    expect(selected.rail?.dedupKey).toBe("k4");
  });

  it("falls back to the first row of the clamped requested page when the selection is missing", () => {
    const fallback = view({
      records: fiveRecords(),
      sortMode: "newest",
      page: 99,
      pageSize: 2,
      selectedDedupKey: "missing-key",
    });

    expect(fallback.page).toBe(2);
    expect(fallback.selectedIndex).toBe(0);
    expect(fallback.selectedRow?.dedupKey).toBe("k4");
  });

  it("finds the nearest surviving dedupKey after removal", () => {
    expect(nearestNotificationDedupKey(["a", "b", "c"], "b")).toBe("c");
    expect(nearestNotificationDedupKey(["a", "b", "c"], "c")).toBe("b");
    expect(nearestNotificationDedupKey(["a"], "a")).toBeNull();
    expect(nearestNotificationDedupKey(["a", "b"], "missing")).toBeNull();
  });
});

describe("buildNotificationsView projection", () => {
  it("projects actionable rows through the shared presentation", () => {
    const projected = view({
      records: [rec({ dedupKey: "a", updatedAt: "2026-07-16T10:00:00.000Z" })],
    });
    const row = projected.rows[0];

    expect(row?.kindLabel).toBe("New episode");
    expect(row?.tone).toBe("success");
    expect(row?.unread).toBe(true);
    expect(row?.actionable).toBe(true);
    expect(row?.primaryAction.id).toBe("queue-next");
    expect(row?.primaryAction.label).toBe("Queue next");
    expect(row?.relativeTime).toBe("2h");
    expect(projected.tabLabel).toBe("Active");
    expect(projected.sortLabel).toBe("Needs attention");
  });

  it("treats dismiss-only notices as non-actionable", () => {
    const projected = view({
      records: [rec({ dedupKey: "a", actionJson: JSON.stringify(["dismiss"]) })],
    });

    expect(projected.rows[0]?.actionable).toBe(false);
    expect(projected.rows[0]?.primaryAction.id).toBe("dismiss");
  });

  it("does not throw on malformed itemJson and keeps text-only facts", () => {
    const projected = view({
      records: [rec({ dedupKey: "a", itemJson: "{not json" })],
    });

    expect(projected.rows[0]?.posterUrl).toBeUndefined();
    expect(projected.rail?.preview.facts.some((fact) => fact.label === "Episode")).toBe(false);
  });

  it("labels unknown kinds generically", () => {
    const projected = view({
      records: [rec({ dedupKey: "a", kind: "future-kind" })],
    });

    expect(projected.rows[0]?.kindLabel).toBe("Notification");
    expect(projected.rows[0]?.glyph).toBe("●");
    expect(projected.rows[0]?.tone).toBe("neutral");
  });

  it("uses tab-specific empty titles", () => {
    expect(view({ records: [], tab: "active" }).emptyTitle).toBe("You're all caught up.");
    expect(view({ records: [], tab: "archive", sortMode: "newest" }).emptyTitle).toBe(
      "No archived notifications.",
    );
    expect(view({ records: [] }).isEmpty).toBe(true);
    expect(view({ records: [] }).selectedRow).toBeNull();
    expect(view({ records: [] }).rail).toBeNull();
  });

  it("omits blank, malformed, and non-HTTP poster URLs", () => {
    const withPoster = (posterUrl: unknown, dedupKey: string) =>
      rec({ dedupKey, itemJson: JSON.stringify({ posterUrl }) });

    const projected = view({
      records: [
        withPoster("https://img.example/p.jpg", "https-ok"),
        withPoster("http://img.example/p.jpg", "http-ok"),
        withPoster("", "blank"),
        withPoster("not a url", "malformed"),
        withPoster("file:///etc/passwd", "non-http"),
        withPoster(42, "non-string"),
      ],
      sortMode: "newest",
    });

    const byKey = new Map(projected.rows.map((row) => [row.dedupKey, row.posterUrl]));
    expect(byKey.get("https-ok")).toBe("https://img.example/p.jpg");
    expect(byKey.get("http-ok")).toBe("http://img.example/p.jpg");
    expect(byKey.get("blank")).toBeUndefined();
    expect(byKey.get("malformed")).toBeUndefined();
    expect(byKey.get("non-http")).toBeUndefined();
    expect(byKey.get("non-string")).toBeUndefined();
  });

  it("projects the selected-notice rail with actions, hints, and media evidence", () => {
    const projected = view({
      records: [
        rec({
          dedupKey: "a",
          updatedAt: "2026-07-16T10:00:00.000Z",
          itemJson: JSON.stringify({
            mediaKind: "anime",
            titleId: "tmdb:1",
            title: "Frieren",
            season: 1,
            episode: 6,
            posterUrl: "https://img.example/frieren.jpg",
            providerHints: [{ providerId: "allanime" }],
          }),
        }),
      ],
    });
    const rail = projected.rail;

    expect(rail?.kindLabel).toBe("New episode");
    expect(rail?.unread).toBe(true);
    expect(rail?.relativeTime).toBe("2h");
    expect(rail?.preview.title).toBe("Frieren S1E13 available");
    expect(rail?.preview.overview).toBe("available on allanime");
    expect(rail?.preview.posterState).toBe("none");
    expect(rail?.preview.posterUrl).toBe("https://img.example/frieren.jpg");
    expect(rail?.primaryAction).toMatchObject({ id: "queue-next", key: "enter" });
    expect(rail?.secondaryActions.map((action) => action.id)).toEqual(["queue-end"]);
    expect(rail?.lifecycleHints).toEqual([
      { key: "r", label: "mark read" },
      { key: "x", label: "archive" },
      { key: "d", label: "delete" },
    ]);

    const facts = new Map(rail?.preview.facts.map((fact) => [fact.label, fact.value]));
    expect(facts.get("Episode")).toBe("S01E06");
    expect(facts.get("Provider")).toBe("allanime");
  });

  it("enriches missing posterUrl from resolvePosterUrl by titleId", () => {
    const projected = view({
      records: [
        rec({
          dedupKey: "a",
          updatedAt: "2026-07-16T10:00:00.000Z",
          itemJson: JSON.stringify({
            mediaKind: "anime",
            titleId: "tmdb:42",
            title: "Frieren",
            season: 1,
            episode: 6,
          }),
        }),
      ],
      resolvePosterUrl: (titleId) =>
        titleId === "tmdb:42" ? "https://image.tmdb.org/t/p/w342/abc.jpg" : undefined,
    });

    expect(projected.rail?.preview.posterUrl).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
  });

  it("normalizes posterPath in itemJson to a TMDB HTTPS URL", () => {
    const projected = view({
      records: [
        rec({
          dedupKey: "a",
          updatedAt: "2026-07-16T10:00:00.000Z",
          itemJson: JSON.stringify({
            mediaKind: "anime",
            titleId: "tmdb:1",
            title: "Frieren",
            posterPath: "/poster.jpg",
          }),
        }),
      ],
    });

    expect(projected.rail?.preview.posterUrl).toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
  });

  it("enriches missing posterUrl from resolvePosterUrl by titleId", () => {
    const projected = view({
      records: [
        rec({
          dedupKey: "a",
          updatedAt: "2026-07-16T10:00:00.000Z",
          itemJson: JSON.stringify({
            mediaKind: "anime",
            titleId: "tmdb:42",
            title: "Frieren",
            season: 1,
            episode: 6,
          }),
        }),
      ],
      resolvePosterUrl: (titleId) =>
        titleId === "tmdb:42" ? "https://image.tmdb.org/t/p/w342/abc.jpg" : undefined,
    });

    expect(projected.rail?.preview.posterUrl).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
  });

  it("normalizes posterPath in itemJson to a TMDB HTTPS URL", () => {
    const projected = view({
      records: [
        rec({
          dedupKey: "a",
          updatedAt: "2026-07-16T10:00:00.000Z",
          itemJson: JSON.stringify({
            mediaKind: "anime",
            titleId: "tmdb:1",
            title: "Frieren",
            posterPath: "/poster.jpg",
          }),
        }),
      ],
    });

    expect(projected.rail?.preview.posterUrl).toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
  });

  it("uses archive lifecycle hints on the archive tab", () => {
    const projected = view({
      records: [rec({ dedupKey: "a", archivedAt: "2026-07-16T11:00:00.000Z" })],
      tab: "archive",
      sortMode: "newest",
    });

    expect(projected.tabLabel).toBe("Archive");
    expect(projected.rail?.lifecycleHints).toEqual([
      { key: "d", label: "delete" },
      { key: "C", label: "clear archive" },
    ]);
  });
});
