import { describe, expect, test } from "bun:test";

import {
  BackgroundWorkScheduler,
  type BackgroundWorkLane,
} from "@/services/background/BackgroundWorkScheduler";

describe("BackgroundWorkScheduler", () => {
  test("runs playback-critical work before lower priority lanes", async () => {
    const order: string[] = [];
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });

    scheduler.enqueue({
      id: "recommendation",
      lane: "recommendation-warm",
      run: async () => {
        order.push("recommendation");
      },
    });
    scheduler.enqueue({
      id: "playback",
      lane: "playback-critical",
      run: async () => {
        order.push("playback");
      },
    });

    await scheduler.drain();

    expect(order).toEqual(["playback", "recommendation"]);
  });

  test("runs explicit user downloads before offline runway replenishment", async () => {
    const order: string[] = [];
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });

    scheduler.enqueue({
      id: "offline-runway:title-1",
      lane: "offline-runway",
      run: () => {
        order.push("runway");
      },
    });
    scheduler.enqueue({
      id: "download:manual",
      lane: "user-requested-download",
      run: () => {
        order.push("manual");
      },
    });

    await scheduler.drain();

    expect(order).toEqual(["manual", "runway"]);
  });

  test("dedupes queued work by id and keeps the newer lane priority", async () => {
    const order: string[] = [];
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });

    scheduler.enqueue({
      id: "title:1",
      lane: "attention-refresh",
      run: async () => {
        order.push("old");
      },
    });
    scheduler.enqueue({
      id: "title:1",
      lane: "next-episode-prefetch",
      run: async () => {
        order.push("new");
      },
    });

    await scheduler.drain();

    expect(order).toEqual(["new"]);
  });

  test("aborts pending lower priority work when its signal is cancelled", async () => {
    const controller = new AbortController();
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });
    const ran: BackgroundWorkLane[] = [];

    scheduler.enqueue({
      id: "cancelled",
      lane: "maintenance-cleanup",
      signal: controller.signal,
      run: async () => {
        ran.push("maintenance-cleanup");
      },
    });
    controller.abort();

    const result = await scheduler.drain();

    expect(ran).toEqual([]);
    expect(result.skipped).toEqual([{ id: "cancelled", reason: "aborted" }]);
  });

  test("coalesces overlapping drains without running the same item twice", async () => {
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });
    const order: string[] = [];

    scheduler.enqueue({
      id: "slow",
      lane: "recommendation-warm",
      run: async () => {
        order.push("slow:start");
        await Bun.sleep(5);
        order.push("slow:end");
      },
    });

    const firstDrain = scheduler.drain();
    const secondDrain = scheduler.drain();
    const [first, second] = await Promise.all([firstDrain, secondDrain]);

    expect(order).toEqual(["slow:start", "slow:end"]);
    expect(first.completed).toEqual(["slow"]);
    expect(second.completed).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.skipped).toEqual([]);
  });

  test("reports mid-run aborts as skipped instead of failed", async () => {
    const controller = new AbortController();
    const scheduler = new BackgroundWorkScheduler({ maxConcurrent: 1 });

    scheduler.enqueue({
      id: "abort-while-running",
      lane: "next-episode-prefetch",
      signal: controller.signal,
      run: async (signal) => {
        controller.abort("user navigated away");
        signal.throwIfAborted();
      },
    });

    const result = await scheduler.drain();

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([{ id: "abort-while-running", reason: "aborted" }]);
  });
});
