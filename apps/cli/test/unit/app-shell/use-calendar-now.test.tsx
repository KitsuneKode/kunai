import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { CALENDAR_NOW_INTERVAL_MS, useCalendarNow } from "@/app-shell/hooks/use-calendar-now";
import { Text } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

function CalendarNowProbe({ enabled }: { readonly enabled: boolean }) {
  return <Text>{`now=${useCalendarNow(enabled)}`}</Text>;
}

describe("useCalendarNow", () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalDateNow = Date.now;
  let timers: Array<{ id: number; callback: () => void; delay: number }> = [];
  let nowMs = 1_000_000;
  let nextTimerId = 1;

  beforeEach(() => {
    timers = [];
    nowMs = 1_000_000;
    nextTimerId = 1;
    globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number) => {
      const id = nextTimerId++;
      timers.push({ id, callback: callback as () => void, delay: delay ?? 0 });
      return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
      timers = timers.filter((timer) => timer.id !== Number(id));
    }) as typeof clearInterval;
    Date.now = () => nowMs;
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    Date.now = originalDateNow;
  });

  test("does not schedule a timer outside the calendar", () => {
    const handle = render(<CalendarNowProbe enabled={false} />, { columns: 40 });
    try {
      expect(timers).toHaveLength(0);
    } finally {
      handle.unmount();
    }
  });

  test("refreshes calendar time every minute and clears the timer", () => {
    const handle = render(<CalendarNowProbe enabled />, { columns: 40 });
    try {
      expect(timers).toHaveLength(1);
      expect(timers[0]?.delay).toBe(CALENDAR_NOW_INTERVAL_MS);
      nowMs = 1_060_000;
      act(() => timers[0]?.callback());
      expect(handle.lastFrame()).toContain(`now=${nowMs}`);
    } finally {
      handle.unmount();
    }
    expect(timers).toHaveLength(0);
  });
});
