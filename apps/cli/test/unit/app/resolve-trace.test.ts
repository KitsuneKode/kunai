import { expect, test } from "bun:test";

import { createResolveTraceStub } from "@/app/resolve-trace";

test("createResolveTraceStub maps anime mode into shared title identity", () => {
  const trace = createResolveTraceStub({
    title: {
      id: "123",
      type: "series",
      name: "Example Anime",
      year: "2024",
    },
    episode: { season: 1, episode: 4 },
    providerId: "anikai",
    mode: "anime",
    startedAt: new Date("2026-04-29T00:00:00.000Z"),
  });

  expect(trace.id).toBe("resolve-1777420800000-anikai-123");
  expect(trace.title.kind).toBe("anime");
  expect(trace.title.anilistId).toBe("123");
  expect(trace.title.tmdbId).toBeUndefined();
  expect(trace.episode?.episode).toBe(4);
  expect(trace.steps[0]?.stage).toBe("provider");
});

test("createResolveTraceStub maps series mode into shared title identity", () => {
  const trace = createResolveTraceStub({
    title: {
      id: "987",
      type: "series",
      name: "Example Series",
      year: "2025",
    },
    providerId: "vidking",
    mode: "series",
    startedAt: new Date("2026-04-29T00:00:00.000Z"),
  });

  expect(trace.title.kind).toBe("series");
  expect(trace.title.tmdbId).toBe("987");
  expect(trace.title.year).toBe(2025);
  expect(trace.cacheHit).toBe(false);
});
