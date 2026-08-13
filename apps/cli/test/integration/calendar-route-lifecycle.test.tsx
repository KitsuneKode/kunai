// =============================================================================
// calendar-route-lifecycle.test.tsx
//
// The calendar route must MOUNT before it loads. Previously the controller
// awaited `loadSearchRoute("calendar")` and only then opened the browse shell,
// so a slow or failing schedule source showed nothing at all — no chrome, no
// loader, no way to press Esc. These assertions pin the ordering at the shell
// seam the controller feeds: the calendar surface, its loader, and its keyboard
// exist before either the schedule request or the idle-context request starts.
//
// Everything here is driven by deferred promises the test resolves by hand.
// No timers, no network, no subprocesses.
// =============================================================================

import { expect, test } from "bun:test";

import { BrowseShell } from "@/app-shell/browse-shell";
import type { BrowseShellOption, BrowseShellSearchResponse } from "@/app-shell/types";
import type { SearchResult } from "@/domain/types";
import React, { act } from "react";

import { render, stripAnsi, type RenderHandle } from "../harness/render-capture";

/** The Sakura glimmer label interleaves colour codes between characters. */
function frame(handle: RenderHandle): string {
  return stripAnsi(handle.lastFrame());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Ink defers a lone ESC briefly to disambiguate it from an escape sequence. */
async function pressEscape(handle: RenderHandle): Promise<void> {
  await act(async () => {
    handle.stdin.enqueue("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

function calendarOption(label: string, dayKey: string): BrowseShellOption<SearchResult> {
  const calendar = {
    source: "anilist" as const,
    titleId: label,
    title: label,
    contentKind: "anime" as const,
    releaseAt: `${dayKey}T10:00:00.000Z`,
    releasePrecision: "timestamp" as const,
    releaseStatus: "upcoming" as const,
    providerConfirmed: false,
    reason: "upcoming-episode" as const,
    dayKey,
    display: {
      time: "10:00",
      statusLabel: "airs later",
      episodeCode: "E01",
      groupLabel: dayKey,
    },
  };
  return {
    label,
    value: {
      id: label,
      type: "series",
      title: label,
      year: "2026",
      overview: "",
      posterPath: null,
      calendar,
    } as unknown as SearchResult,
    calendar,
  } as BrowseShellOption<SearchResult>;
}

function calendarResponse(labels: readonly string[]): BrowseShellSearchResponse<SearchResult> {
  return {
    options: labels.map((label) => calendarOption(label, "2026-06-14")),
    subtitle: `${labels.length} this week · 1 airing today · 0 released`,
    emptyMessage: "No releases found for the next week.",
  };
}

const BASE_PROPS = {
  mode: "anime" as const,
  provider: "allanime",
  placeholder: "Search",
  commands: [],
  onSearch: async () => ({ options: [], subtitle: "", emptyMessage: "" }),
  onResolve: () => {},
  onSubmit: () => {},
  onCancel: () => {},
};

test("the calendar surface mounts and paints before its schedule request or idle context starts", async () => {
  const events: string[] = [];
  const schedule = deferred<BrowseShellSearchResponse<SearchResult>>();
  const idle = deferred<undefined>();

  const handle = render(
    <BrowseShell<SearchResult>
      {...BASE_PROPS}
      initialCalendarRoute={{ kind: "calendar", requestKey: 1 }}
      onLoadCalendar={(signal) => {
        events.push("calendar-load-started");
        signal.addEventListener("abort", () => events.push("calendar-load-aborted"));
        return schedule.promise;
      }}
      onCalendarAccepted={() => events.push("calendar-accepted")}
      loadIdleContext={async () => {
        events.push("idle-context-load-started");
        await idle.promise;
        return undefined;
      }}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    const firstFrame = frame(handle);
    events.unshift("browse-mounted:calendar-loading");
    // The very first committed frame is already the calendar loading surface.
    expect(firstFrame).toContain("Loading release schedule");
    expect(events.indexOf("browse-mounted:calendar-loading")).toBeLessThan(
      events.indexOf("calendar-load-started"),
    );
    expect(events.indexOf("browse-mounted:calendar-loading")).toBeLessThan(
      events.indexOf("idle-context-load-started"),
    );

    await act(async () => {
      schedule.resolve(calendarResponse(["Frieren", "Dandadan"]));
      await flush();
    });
    events.push("calendar-load-completed");
    events.push("browse-rendered:calendar-success");

    expect(events).toEqual([
      "browse-mounted:calendar-loading",
      "calendar-load-started",
      "idle-context-load-started",
      "calendar-accepted",
      "calendar-load-completed",
      "browse-rendered:calendar-success",
    ]);
    expect(frame(handle)).toContain("Frieren");
  } finally {
    idle.resolve(undefined);
    handle.unmount();
  }
});

test("a zero-row schedule keeps calendar identity instead of falling back to browse idle", async () => {
  const schedule = deferred<BrowseShellSearchResponse<SearchResult>>();
  const handle = render(
    <BrowseShell<SearchResult>
      {...BASE_PROPS}
      initialCalendarRoute={{ kind: "calendar", requestKey: 1 }}
      onLoadCalendar={() => schedule.promise}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    await act(async () => {
      schedule.resolve({
        options: [],
        subtitle: "No releases found for the next week",
        emptyMessage: "No releases found for the next week.",
      });
      await flush();
    });
    const emptyFrame = frame(handle);
    expect(emptyFrame).toContain("Nothing on the schedule");
    // Browse's generic idle/empty copy must not take the surface back.
    expect(emptyFrame).not.toContain("try /trending to see what's popular");
  } finally {
    handle.unmount();
  }
});

test("a failed schedule stays on calendar chrome and offers an r retry that reloads in place", async () => {
  const attempts: Array<ReturnType<typeof deferred<BrowseShellSearchResponse<SearchResult>>>> = [];
  const handle = render(
    <BrowseShell<SearchResult>
      {...BASE_PROPS}
      initialCalendarRoute={{ kind: "calendar", requestKey: 1 }}
      onLoadCalendar={() => {
        const next = deferred<BrowseShellSearchResponse<SearchResult>>();
        attempts.push(next);
        return next.promise;
      }}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    await act(async () => {
      attempts[0]?.reject(new Error("every schedule source failed"));
      await flush();
    });
    expect(frame(handle)).toContain("Schedule unavailable");
    expect(frame(handle)).toContain("Refresh schedule");

    handle.stdin.enqueue("r");
    await act(async () => {
      await flush();
    });
    expect(attempts.length).toBe(2);

    await act(async () => {
      attempts[1]?.resolve(calendarResponse(["Frieren"]));
      await flush();
    });
    expect(frame(handle)).toContain("Frieren");
  } finally {
    handle.unmount();
  }
});

test("Esc during loading aborts the schedule request and no late frame can paint", async () => {
  const signals: AbortSignal[] = [];
  const accepted: number[] = [];
  const schedule = deferred<BrowseShellSearchResponse<SearchResult>>();
  const handle = render(
    <BrowseShell<SearchResult>
      {...BASE_PROPS}
      initialCalendarRoute={{ kind: "calendar", requestKey: 1 }}
      onLoadCalendar={(signal) => {
        signals.push(signal);
        return schedule.promise;
      }}
      onCalendarAccepted={(request) => accepted.push(request.requestKey)}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    expect(frame(handle)).toContain("Loading release schedule");
    await pressEscape(handle);
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      // The abandoned request finishes after the user already left.
      schedule.resolve(calendarResponse(["Frieren"]));
      await flush();
    });
    expect(accepted).toEqual([]);
    expect(frame(handle)).not.toContain("Frieren");
  } finally {
    handle.unmount();
  }
});

test("loading trending after the schedule settles hands the surface back to ordinary results", async () => {
  const schedule = deferred<BrowseShellSearchResponse<SearchResult>>();
  const handle = render(
    <BrowseShell<SearchResult>
      {...BASE_PROPS}
      initialCalendarRoute={{ kind: "calendar", requestKey: 1 }}
      onLoadCalendar={() => schedule.promise}
      onLoadDiscovery={async () => ({
        options: [{ label: "Dune", value: { id: "dune", title: "Dune" } as SearchResult }],
        subtitle: "1 trending pick",
        emptyMessage: "",
      })}
    />,
    { columns: 100, rows: 30 },
  );

  try {
    await act(async () => {
      schedule.resolve(calendarResponse(["Frieren"]));
      await flush();
    });
    expect(frame(handle)).toContain("Frieren");

    // Ctrl+T loads trending. A settled calendar route must not keep rendering
    // ordinary results through calendar chrome.
    handle.stdin.enqueue("\u0014");
    await act(async () => {
      await flush();
    });
    const trending = frame(handle);
    expect(trending).toContain("Dune");
    expect(trending).not.toContain("Frieren");
    expect(trending).not.toContain("day");
  } finally {
    handle.unmount();
  }
});
