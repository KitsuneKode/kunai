import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { CALENDAR_NOW_INTERVAL_MS, useCalendarNow } from "@/app-shell/hooks/use-calendar-now";
import { Text, useInput } from "ink";
import React, { act, useState } from "react";

import { render } from "../../harness/render-capture";

function CalendarNowProbe({ paused }: { readonly paused: boolean }) {
  const now = useCalendarNow(paused);
  return <Text>{`now=${now}`}</Text>;
}

/** Same-mount pause toggle — harness `rerender` remounts, so props alone cannot prove clear-on-pause. */
function TogglePauseProbe() {
  const [paused, setPaused] = useState(false);
  const now = useCalendarNow(paused);
  useInput((input) => {
    if (input === "p") setPaused(true);
  });
  return <Text>{`now=${now} paused=${paused ? "1" : "0"}`}</Text>;
}

describe("useCalendarNow", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalDateNow = Date.now;

  type TimerEntry = {
    id: number;
    callback: () => void;
    delay: number;
  };

  let timers: TimerEntry[] = [];
  let nowMs = 1_000_000;
  let nextTimerId = 1;

  beforeEach(() => {
    timers = [];
    nowMs = 1_000_000;
    nextTimerId = 1;

    globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number) => {
      const id = nextTimerId++;
      timers.push({
        id,
        callback: callback as () => void,
        delay: delay ?? 0,
      });
      return id as unknown as ReturnType<typeof setInterval>;
    }) as unknown as typeof setInterval;

    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      const resolvedId = Number(id as unknown as number);
      timers = timers.filter((timer) => timer.id !== resolvedId);
    }) as unknown as typeof clearInterval;

    Date.now = () => nowMs;
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
    timers = [];
  });

  test("does not schedule an interval while paused", () => {
    const handle = render(<CalendarNowProbe paused />, { columns: 40 });
    try {
      expect(handle.lastFrame()).toContain(`now=${nowMs}`);
      expect(timers).toHaveLength(0);
    } finally {
      handle.unmount();
    }
  });

  test("schedules a 60s interval when not paused and clears on unmount", () => {
    const handle = render(<CalendarNowProbe paused={false} />, { columns: 40 });
    try {
      expect(timers).toHaveLength(1);
      expect(timers[0]?.delay).toBe(CALENDAR_NOW_INTERVAL_MS);

      nowMs = 1_060_000;
      act(() => {
        timers[0]?.callback();
      });
      expect(handle.lastFrame()).toContain(`now=${nowMs}`);
    } finally {
      handle.unmount();
    }
    expect(timers).toHaveLength(0);
  });

  test("clears the interval when paused becomes true on the same mount", () => {
    const handle = render(<TogglePauseProbe />, { columns: 40 });
    try {
      expect(timers).toHaveLength(1);
      handle.stdin.enqueue("p");
      expect(handle.lastFrame()).toContain("paused=1");
      expect(timers).toHaveLength(0);
    } finally {
      handle.unmount();
    }
  });
});
