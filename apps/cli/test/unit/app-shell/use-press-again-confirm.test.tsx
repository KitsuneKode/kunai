import { describe, expect, test } from "bun:test";

import type { DismissTimerOperations } from "@/app-shell/dismiss-timer-registry";
import {
  PRESS_AGAIN_WINDOW_MS,
  usePressAgainConfirm,
  type PressAgainConfirm,
} from "@/app-shell/hooks/use-press-again-confirm";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

/** Manual clock seam — scheduled callbacks queue until `fire` runs them. */
function fakeTimers() {
  const queue = new Map<number, () => void>();
  let nextId = 0;
  const timers: DismissTimerOperations = {
    setTimeout: (callback) => {
      nextId += 1;
      queue.set(nextId, callback);
      return nextId;
    },
    clearTimeout: (handle) => {
      // SAFETY: every handle this seam hands out is the number we minted above.
      queue.delete(handle as number);
    },
  };
  return {
    timers,
    pending: () => queue.size,
    fireAll: () => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback();
    },
  };
}

/** Mutable box the probe component writes the live hook value into. */
type HookSink = {
  current?: PressAgainConfirm;
};

function HookProbe({ timers, sink }: { timers?: DismissTimerOperations; sink: HookSink }) {
  sink.current = usePressAgainConfirm(timers);
  return null;
}

function mountHook(timers?: DismissTimerOperations) {
  const sink: HookSink = {};
  const handle = render(<HookProbe timers={timers} sink={sink} />, {
    columns: 60,
    rows: 10,
  });
  return {
    handle,
    get: () => {
      if (!sink.current) throw new Error("hook probe never rendered");
      return sink.current;
    },
  };
}

describe("usePressAgainConfirm", () => {
  test("first press arms, matching second press confirms and clears", () => {
    const { handle, get } = mountHook(fakeTimers().timers);
    try {
      let confirmed = false;
      act(() => {
        confirmed = get().confirm("row-1");
      });
      expect(confirmed).toBe(false);
      expect(get().armedToken).toBe("row-1");

      act(() => {
        confirmed = get().confirm("row-1");
      });
      expect(confirmed).toBe(true);
      expect(get().armedToken).toBeNull();
    } finally {
      handle.unmount();
    }
  });

  test("a different token re-arms instead of confirming", () => {
    const { handle, get } = mountHook();
    try {
      act(() => {
        get().confirm("row-1");
      });
      let confirmed = true;
      act(() => {
        confirmed = get().confirm("row-2");
      });
      expect(confirmed).toBe(false);
      expect(get().armedToken).toBe("row-2");
    } finally {
      handle.unmount();
    }
  });

  test("armed token expires when the window elapses", () => {
    const clock = fakeTimers();
    const { handle, get } = mountHook(clock.timers);
    try {
      act(() => {
        get().confirm("row-1");
      });
      expect(get().armedToken).toBe("row-1");
      act(() => {
        clock.fireAll();
      });
      expect(get().armedToken).toBeNull();
    } finally {
      handle.unmount();
    }
  });

  test("disarm drops the token AND its expiry timer", () => {
    const clock = fakeTimers();
    const { handle, get } = mountHook(clock.timers);
    try {
      act(() => {
        get().confirm("row-1");
      });
      act(() => {
        get().disarm();
      });
      expect(get().armedToken).toBeNull();
      expect(clock.pending()).toBe(0);
    } finally {
      handle.unmount();
    }
  });

  test("a stale expiry cannot disarm a later re-arm of the same token", () => {
    const clock = fakeTimers();
    const { handle, get } = mountHook(clock.timers);
    try {
      act(() => {
        get().confirm("row-1");
      });
      act(() => {
        get().disarm();
      });
      act(() => {
        get().confirm("row-1");
      });
      // The first arm's timer was disposed with disarm(); whatever is queued
      // now belongs to the second arm — firing it must not kill the new arm
      // before its own window, and the token survives the stale callback.
      expect(get().armedToken).toBe("row-1");
      act(() => {
        clock.fireAll();
      });
      expect(get().armedToken).toBeNull();
    } finally {
      handle.unmount();
    }
  });

  test("schedules expiry on the shared press-again window", () => {
    const delays: number[] = [];
    const timers: DismissTimerOperations = {
      setTimeout: (_cb, delay) => {
        delays.push(delay);
        return 0;
      },
      clearTimeout: () => {},
    };
    const { handle, get } = mountHook(timers);
    try {
      act(() => {
        get().confirm("row-1");
      });
      expect(delays).toEqual([PRESS_AGAIN_WINDOW_MS]);
    } finally {
      handle.unmount();
    }
  });
});
