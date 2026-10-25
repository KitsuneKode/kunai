import { describe, expect, test } from "bun:test";

import {
  createTranscodeSlotGate,
  MAX_PARALLEL_TRANSCODES,
} from "@/services/download/transcode-slots";

describe("transcode slot gate", () => {
  test("caps parallel finalizations at MAX_PARALLEL_TRANSCODES (2)", async () => {
    expect(MAX_PARALLEL_TRANSCODES).toBe(2);
    const gate = createTranscodeSlotGate();
    let inFlight = 0;
    let peak = 0;
    const work = async () => {
      const release = await gate.acquire();
      try {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // SAFETY: yields control so all five contenders overlap inside the gate.
        await Bun.sleep(10);
        inFlight -= 1;
      } finally {
        release();
      }
    };
    await Promise.all([work(), work(), work(), work(), work()]);
    expect(peak).toBe(2);
    expect(gate.held).toBe(0);
  });

  test("slots transfer FIFO and double release is harmless", async () => {
    const gate = createTranscodeSlotGate(1);
    const order: string[] = [];
    const first = await gate.acquire();
    const second = gate.acquire().then((release) => {
      order.push("second");
      release();
      // SAFETY: a second release call must not free a slot held by someone else.
      release();
      return "second";
    });
    order.push("first");
    first();
    await second;
    expect(order).toEqual(["first", "second"]);
    expect(gate.held).toBe(0);
  });
});
