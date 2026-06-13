import { describe, expect, test } from "bun:test";

import { buildQueueView } from "@/app-shell/queue-view";
import type { QueueEntry } from "@kunai/storage";

function entry(p: Partial<QueueEntry> & { id: string; title: string }): QueueEntry {
  return {
    mediaKind: "anime",
    titleId: p.title,
    priority: 0,
    source: "manual",
    addedAt: "2026-06-14T00:00:00Z",
    sessionId: "s1",
    status: "pending",
    ...p,
  } as QueueEntry;
}

const base = {
  selectedId: null,
  resolvePoster: () => undefined,
  recoverableSessions: 0,
};

describe("buildQueueView", () => {
  test("empty with no recoverable sessions", () => {
    const v = buildQueueView({ entries: [], ...base });
    expect(v.state).toBe("empty");
    expect(v.emptyHint).toContain("add from");
  });

  test("empty with recoverable session hints restore", () => {
    const v = buildQueueView({ entries: [], ...base, recoverableSessions: 1 });
    expect(v.emptyHint).toContain("restore");
  });

  test("orders played first then unplayed, with 1-based unplayed positions", () => {
    const entries = [
      entry({ id: "1", title: "Done", playedAt: "2026-06-14T01:00:00Z" }),
      entry({ id: "2", title: "Next", season: 2, episode: 8 }),
      entry({ id: "3", title: "Later", episode: 3 }),
    ];
    const v = buildQueueView({ entries, ...base, selectedId: "2" });
    expect(v.rows.map((r) => r.state)).toEqual(["played", "playing", "pending"]);
    expect(v.rows[1]!.position).toBe(1);
    expect(v.rows[1]!.episodeLabel).toBe("S02·E08");
    expect(v.rows[2]!.episodeLabel).toBe("E03");
    expect(v.selectedIndex).toBe(1);
    expect(v.counts).toEqual({ unplayed: 2, total: 3 });
  });

  test("maps source labels and resolves posters", () => {
    const entries = [entry({ id: "2", title: "Next", source: "history" })];
    const v = buildQueueView({ entries, ...base, resolvePoster: (id) => `http://p/${id}` });
    expect(v.rows[0]!.sourceLabel).toBe("from history");
    expect(v.rows[0]!.posterUrl).toBe("http://p/Next");
    expect(v.rail?.posterUrl).toBe("http://p/Next");
  });

  test("movie media kind labels as Movie", () => {
    const entries = [entry({ id: "m", title: "Film", mediaKind: "movie" })];
    const v = buildQueueView({ entries, ...base });
    expect(v.rows[0]!.episodeLabel).toBe("Movie");
  });
});
