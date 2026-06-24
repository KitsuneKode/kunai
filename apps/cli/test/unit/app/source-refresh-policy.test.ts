import { expect, test } from "bun:test";

import {
  createSourceRefreshCooldownState,
  resolveSourceRefreshDecision,
} from "@/app/playback/source-refresh-policy";

const scope = {
  titleId: "tmdb:1",
  season: 1,
  episode: 6,
  providerId: "vidking",
  sourceId: "source-a",
  streamId: "1080p",
};

test("source refresh cooldown blocks repeated voluntary refresh but keeps playback usable", () => {
  const state = createSourceRefreshCooldownState();
  const now = new Date("2026-05-17T00:00:00.000Z");

  const first = resolveSourceRefreshDecision(state, {
    action: "refresh",
    scope,
    now,
    cooldownMs: 30_000,
  });

  const second = resolveSourceRefreshDecision(state, {
    action: "refresh",
    scope,
    now: new Date("2026-05-17T00:00:10.000Z"),
    cooldownMs: 30_000,
  });

  expect(first.kind).toBe("refresh");
  expect(second).toEqual({
    kind: "cooldown",
    message: "Source was refreshed recently. Continuing current stream.",
    remainingMs: 20_000,
  });
});

test("source refresh cooldown never blocks recover after failed playback evidence", () => {
  const state = createSourceRefreshCooldownState();
  const now = new Date("2026-05-17T00:00:00.000Z");

  resolveSourceRefreshDecision(state, {
    action: "refresh",
    scope,
    now,
    cooldownMs: 30_000,
  });

  const recover = resolveSourceRefreshDecision(state, {
    action: "recover",
    scope,
    now: new Date("2026-05-17T00:00:10.000Z"),
    cooldownMs: 30_000,
  });

  expect(recover).toEqual({
    kind: "recover",
    bypassCache: true,
    invalidateSuspectCache: true,
  });
});
