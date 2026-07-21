import { expect, test } from "bun:test";

import type { EpisodeInfo, PlaybackTimingMetadata, TitleInfo } from "@/domain/types";
import {
  PlaybackTimingAggregator,
  type PlaybackTimingSource,
  type PlaybackTimingSourceOutcome,
} from "@/infra/timing";

const TITLE: TitleInfo = {
  id: "12345",
  type: "series",
  name: "Deadline Series",
};

const EPISODE: EpisodeInfo = { season: 1, episode: 1 };

function hangingSource(name = "hang"): PlaybackTimingSource {
  return {
    name,
    canHandle: () => true,
    fetch: ({ signal }) =>
      new Promise<PlaybackTimingMetadata | null>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
  };
}

test("source deadline fires while caller signal remains live", async () => {
  const outcomes: PlaybackTimingSourceOutcome[] = [];
  const parent = new AbortController();
  const aggregator = new PlaybackTimingAggregator([hangingSource()], {
    sourceDeadlineMs: 30,
    aggregateDeadlineMs: 5_000,
  });

  const timing = await aggregator.resolve(TITLE, EPISODE, "series", parent.signal, {
    onSourceOutcome: (outcome) => outcomes.push(outcome),
  });

  expect(timing).toBeNull();
  expect(parent.signal.aborted).toBe(false);
  expect(outcomes[0]?.failureClass).toBe("timeout");
  expect(outcomes[0]?.source).toBe("hang");
});

test("aggregate deadline fires while caller signal remains live", async () => {
  const outcomes: PlaybackTimingSourceOutcome[] = [];
  const parent = new AbortController();
  const aggregator = new PlaybackTimingAggregator([hangingSource("slow")], {
    sourceDeadlineMs: 5_000,
    aggregateDeadlineMs: 30,
  });

  const timing = await aggregator.resolve(TITLE, EPISODE, "series", parent.signal, {
    onSourceOutcome: (outcome) => outcomes.push(outcome),
  });

  expect(timing).toBeNull();
  expect(parent.signal.aborted).toBe(false);
  expect(outcomes[0]?.failureClass).toBe("timeout");
});

test("caller cancellation classifies sources as cancelled", async () => {
  const outcomes: PlaybackTimingSourceOutcome[] = [];
  const parent = new AbortController();
  const aggregator = new PlaybackTimingAggregator([hangingSource("cancel-me")], {
    sourceDeadlineMs: 5_000,
    aggregateDeadlineMs: 5_000,
  });

  const pending = aggregator.resolve(TITLE, EPISODE, "series", parent.signal, {
    onSourceOutcome: (outcome) => outcomes.push(outcome),
  });
  await Bun.sleep(5);
  parent.abort();
  const timing = await pending;

  expect(timing).toBeNull();
  expect(parent.signal.aborted).toBe(true);
  expect(outcomes[0]?.failureClass).toBe("cancelled");
});

test("successful sources still merge when a sibling times out", async () => {
  const outcomes: PlaybackTimingSourceOutcome[] = [];
  const ok: PlaybackTimingSource = {
    name: "ok",
    canHandle: () => true,
    fetch: async () => ({
      tmdbId: "12345",
      type: "series",
      intro: [{ startMs: 10, endMs: 20 }],
      recap: [],
      credits: [],
      preview: [],
    }),
  };
  const aggregator = new PlaybackTimingAggregator([ok, hangingSource("late")], {
    sourceDeadlineMs: 40,
    aggregateDeadlineMs: 5_000,
  });
  const parent = new AbortController();

  const timing = await aggregator.resolve(TITLE, EPISODE, "series", parent.signal, {
    onSourceOutcome: (outcome) => outcomes.push(outcome),
  });

  expect(parent.signal.aborted).toBe(false);
  expect(timing?.intro).toEqual([{ startMs: 10, endMs: 20 }]);
  expect(outcomes.find((o) => o.source === "ok")?.failureClass).toBeNull();
  expect(outcomes.find((o) => o.source === "late")?.failureClass).toBe("timeout");
});
