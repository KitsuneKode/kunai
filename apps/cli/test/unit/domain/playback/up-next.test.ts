import { expect, test } from "bun:test";

import type { PlayableRef } from "@/domain/playback/playable-ref";
import { resolveUpNext } from "@/domain/playback/up-next";

const nextEp: PlayableRef = {
  titleId: "tmdb:1",
  mediaKind: "series",
  title: "Example",
  season: 1,
  episode: 4,
  source: "queue",
};
const queued: PlayableRef = {
  titleId: "tmdb:2",
  mediaKind: "movie",
  title: "Other",
  source: "queue",
};

test("episode chain wins when autoplay is eligible and a next episode exists", () => {
  const up = resolveUpNext({ nextEpisode: nextEp, queueNext: queued, autoplayEligible: true });
  expect(up.kind).toBe("episode-chain");
  expect(up.kind === "episode-chain" && up.ref.episode).toBe(4);
});

test("falls back to the queue when autoplay is not eligible (e.g. movie / paused)", () => {
  const up = resolveUpNext({ nextEpisode: nextEp, queueNext: queued, autoplayEligible: false });
  expect(up.kind).toBe("queue");
  expect(up.kind === "queue" && up.ref.titleId).toBe("tmdb:2");
});

test("falls back to the queue when there is no next episode", () => {
  const up = resolveUpNext({ nextEpisode: null, queueNext: queued, autoplayEligible: true });
  expect(up.kind).toBe("queue");
});

test("none when neither a next episode nor a queued item exists", () => {
  expect(resolveUpNext({ autoplayEligible: true }).kind).toBe("none");
  expect(
    resolveUpNext({ nextEpisode: nextEp, autoplayEligible: false, queueNext: null }).kind,
  ).toBe("none");
});
