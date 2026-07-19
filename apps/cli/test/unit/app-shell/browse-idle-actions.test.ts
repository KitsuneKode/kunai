import { describe, expect, test } from "bun:test";

import {
  buildBrowseIdleReturnLoopModel,
  resolveIdleContinueAction,
  resolveIdleRowAction,
} from "@/app-shell/browse-idle-actions";
import { RETURN_LOOP_FOR_YOU_NOW_HEADING } from "@/app-shell/return-loop-copy";

describe("browse idle actions", () => {
  test("inline continue rows resume the shown title instead of opening the global continue menu", () => {
    expect(
      resolveIdleContinueAction({
        continueWatching: {
          title: "The WONDERfools",
          ep: "S01E04",
          titleId: "tmdb:123",
          mediaKind: "series",
        },
      }),
    ).toBe("resume-continue-watching");
  });

  test("missing inline history target falls back to the global continue surface", () => {
    expect(resolveIdleContinueAction(undefined)).toBe("continue");
  });

  test("buildBrowseIdleReturnLoopModel merges resume, queue, releases, and calendar nudges", () => {
    const model = buildBrowseIdleReturnLoopModel(
      {
        continueWatching: {
          title: "In Progress",
          ep: "S01E02",
          titleId: "tmdb:1",
          mediaKind: "series",
        },
        playlistNext: {
          title: "Queued Title",
          ep: "S02E01",
          titleId: "tmdb:3",
          mediaKind: "series",
        },
        offlineReadyNext: {
          title: "Offline Title",
          ep: "S01E06",
          titleId: "tmdb:2",
          offlineJobId: "job-offline-1",
        },
        todayReleaseCount: 2,
        todayReleaseTitleCount: 1,
        calendarNudge: { airingTodayCount: 3 },
      },
      { idleFocused: true, selectedIndex: 0 },
    );
    expect(model?.heading).toBe(RETURN_LOOP_FOR_YOU_NOW_HEADING);
    expect(model?.rows.map((row) => row.id)).toEqual([
      "continue",
      "offline-ready",
      "playlist-next",
      "ready-now",
      "calendar-nudge",
    ]);
    expect(model?.rows[0]?.hint).toBe("↵ resume · m menu");
    expect(model?.rows[2]?.hint).toBeUndefined();
    expect(model?.rows[3]?.meta).toBe("2 new episodes · 1 show");
    expect(model?.hasSelectableRows).toBe(true);
  });

  test("resolveIdleRowAction maps row ids to shell actions", () => {
    const context = {
      continueWatching: { title: "A", titleId: "tmdb:1", mediaKind: "series" as const },
      offlineReadyNext: { title: "B", offlineJobId: "job-1", titleId: "tmdb:2" },
      playlistNext: { title: "C", titleId: "tmdb:3", mediaKind: "series" },
      todayReleaseCount: 1,
      calendarNudge: { airingTodayCount: 2 },
    };
    expect(resolveIdleRowAction("continue", context)).toBe("resume-continue-watching");
    expect(resolveIdleRowAction("offline-ready", context)).toBe("play-offline-ready");
    expect(resolveIdleRowAction("playlist-next", context)).toBe("play-queue-next");
    expect(resolveIdleRowAction("ready-now", context)).toBe("notifications");
    expect(resolveIdleRowAction("calendar-nudge", context)).toBe("calendar");
  });
});
