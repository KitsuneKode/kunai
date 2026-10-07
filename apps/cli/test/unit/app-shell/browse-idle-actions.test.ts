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
    // Not plain "calendar": the row counts *tracked* titles airing, so it must
    // land on the Tracked tab. Opening the unfiltered All tab made the count
    // look wrong and left the user to find the tab themselves.
    expect(resolveIdleRowAction("calendar-nudge", context)).toBe("tracked-calendar");
  });

  test("the calendar nudge stays inert when nothing tracked is airing", () => {
    expect(resolveIdleRowAction("calendar-nudge", { calendarNudge: { airingTodayCount: 0 } })).toBe(
      null,
    );
  });

  test("provider-controlled titles cannot inject terminal control sequences", () => {
    const model = buildBrowseIdleReturnLoopModel(
      {
        continueWatching: {
          title: "Evil\x1b[2J\x1b[H title\x07",
          ep: "S01\x1b[31mE02",
          titleId: "tmdb:1",
          mediaKind: "series",
        },
        playlistNext: {
          title: "Queued\x1b]52;c;Y2xpcA==\x07 Title",
          ep: "S02E01\x07",
          titleId: "tmdb:3",
          mediaKind: "series",
        },
        offlineReadyNext: {
          title: "Off\x1b[8mline",
          ep: "S01\x07E06",
          titleId: "tmdb:2",
          offlineJobId: "job-offline-1",
        },
      },
      { idleFocused: false, selectedIndex: 0 },
    );
    const hasControlChars = (value: string) =>
      [...value].some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x20 || (code >= 0x7f && code <= 0x9f);
      });
    for (const row of model?.rows ?? []) {
      expect(hasControlChars(row.title)).toBe(false);
      if (row.meta !== undefined) {
        expect(hasControlChars(row.meta)).toBe(false);
      }
    }
    expect(model?.rows[0]?.title).toBe("Evil title");
    expect(model?.rows[1]?.title).toBe("Offline");
    expect(model?.rows[2]?.title).toBe("Queued Title");
  });
});
