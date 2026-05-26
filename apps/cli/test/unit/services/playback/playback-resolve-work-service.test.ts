import { describe, expect, test } from "bun:test";

import type { PlaybackResolveCoordinatorOutput } from "@/services/playback/PlaybackResolveCoordinator";
import type { PlaybackResolveInput } from "@/services/playback/PlaybackResolveService";
import { PlaybackResolveWorkService } from "@/services/playback/PlaybackResolveWorkService";
import type { ResolveWorkLedgerSnapshot } from "@/services/playback/ResolveWorkLedger";

const baseInput = (): PlaybackResolveInput => ({
  title: { id: "series-1", type: "series", name: "Series" },
  episode: { season: 1, episode: 2 },
  mode: "series",
  providerId: "vidking",
  audioPreference: "original",
  subtitlePreference: "none",
  signal: new AbortController().signal,
});

const output: PlaybackResolveCoordinatorOutput = {
  stream: {
    url: "https://example.invalid/stream.m3u8",
    headers: {},
    timestamp: Date.now(),
  },
  providerId: "vidking",
  attempts: [],
  cacheStatus: "miss",
  cacheProvenance: "fresh",
  provenance: "fresh",
};

describe("PlaybackResolveWorkService", () => {
  test("joins exact prefetch and foreground playback onto one physical resolve", async () => {
    let calls = 0;
    let release!: (result: PlaybackResolveCoordinatorOutput) => void;
    const coordinator = {
      resolve: async () => {
        calls += 1;
        return new Promise<PlaybackResolveCoordinatorOutput>((resolve) => {
          release = resolve;
        });
      },
    };
    const service = new PlaybackResolveWorkService(coordinator);

    const prefetch = service.resolve(baseInput(), {
      intentKind: "prefetch",
      budgetLane: "near-need",
    });
    const foreground = service.resolve(baseInput(), {
      intentKind: "playback",
      budgetLane: "user-blocking",
    });
    release(output);

    const [first, joined] = await Promise.all([prefetch, foreground]);

    expect(calls).toBe(1);
    expect(first.workLedger.intents).toEqual(["prefetch", "playback"]);
    expect(joined.workLedger.joinedBudgetLanes).toEqual(["near-need", "user-blocking"]);
  });

  test("does not join download work to a matching playback resolve", async () => {
    let calls = 0;
    const service = new PlaybackResolveWorkService({
      resolve: async () => {
        calls += 1;
        return output;
      },
    });

    await Promise.all([
      service.resolve(baseInput(), { intentKind: "playback", budgetLane: "user-blocking" }),
      service.resolve(baseInput(), { intentKind: "download", budgetLane: "background" }),
    ]);

    expect(calls).toBe(2);
  });

  test("reports completed resolve work ledgers", async () => {
    const completed: ResolveWorkLedgerSnapshot[] = [];
    const service = new PlaybackResolveWorkService(
      {
        resolve: async () => output,
      },
      {
        onCompletedLedger: (ledger) => completed.push(ledger),
      },
    );

    const result = await service.resolve(baseInput(), {
      intentKind: "playback",
      budgetLane: "user-blocking",
    });

    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual(result.workLedger);
    expect(completed[0]).toMatchObject({ outcome: "resolved", intents: ["playback"] });
  });

  test("detaches an aborted prefetch consumer without aborting joined foreground work", async () => {
    const prefetchController = new AbortController();
    let physicalSignal: AbortSignal | undefined;
    let release!: (result: PlaybackResolveCoordinatorOutput) => void;
    const service = new PlaybackResolveWorkService({
      resolve: async (input) => {
        physicalSignal = input.signal;
        return new Promise<PlaybackResolveCoordinatorOutput>((resolve) => {
          release = resolve;
        });
      },
    });
    const prefetch = service.resolve(
      { ...baseInput(), signal: prefetchController.signal },
      { intentKind: "prefetch", budgetLane: "near-need" },
    );
    const foreground = service.resolve(baseInput(), {
      intentKind: "playback",
      budgetLane: "user-blocking",
    });

    prefetchController.abort();
    release(output);

    await expect(prefetch).rejects.toMatchObject({ name: "AbortError" });
    expect((await foreground).stream?.url).toContain("stream.m3u8");
    expect(physicalSignal?.aborted).toBe(false);
  });
});
