import { describe, expect, test } from "bun:test";

import { connectNamedTracker } from "@/app-shell/workflows/tracker-connect";
import type { Container } from "@/container";

function fakeContainer(
  connect: (signal: AbortSignal) => Promise<{ ok: true } | { ok: false; error: string }>,
) {
  const notes: string[] = [];
  const container = {
    stateManager: {
      dispatch: (action: { type: string; note?: string }) => {
        if (action.note) notes.push(action.note);
      },
    },
    syncService: {
      adapters: [
        {
          id: "anilist",
          displayName: "AniList",
          getConnection: () => ({ state: "disconnected" }),
          connect: ({ signal }: { signal: AbortSignal }) => connect(signal),
        },
      ],
      resumeAfterReauth: () => 0,
      deliverSoon: () => undefined,
    },
  } as unknown as Container;
  return { container, notes };
}

describe("connectNamedTracker", () => {
  test("threads the caller's abort signal and reports cancellation distinctly", async () => {
    let observedSignal: AbortSignal | null = null;
    const { container, notes } = fakeContainer(async (signal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      return { ok: false, error: "cancelled" };
    });
    const controller = new AbortController();

    const pending = connectNamedTracker(container, "anilist", { signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual({ status: "cancelled" });
    expect(observedSignal === controller.signal).toBe(true);
    expect(notes.at(-1)).toContain("cancelled");
  });

  test("reports a failed handoff without claiming the tracker is connected", async () => {
    const { container, notes } = fakeContainer(async () => ({
      ok: false,
      error: "approval expired",
    }));

    await expect(
      connectNamedTracker(container, "anilist", { signal: new AbortController().signal }),
    ).resolves.toEqual({ status: "failed", error: "approval expired" });
    expect(notes.at(-1)).toContain("approval expired");
  });
});
