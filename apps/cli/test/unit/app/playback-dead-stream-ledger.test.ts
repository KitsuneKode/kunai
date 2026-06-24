import { expect, test } from "bun:test";

import {
  createDeadStreamUrlLedger,
  playbackDeadStreamScopeKey,
} from "@/app/playback/playback-dead-stream-ledger";

test("dead stream ledger records blocked URLs per title episode and provider", () => {
  const ledger = createDeadStreamUrlLedger();
  const scope = playbackDeadStreamScopeKey({
    titleId: "tmdb:1",
    season: 2,
    episode: 3,
    providerId: "vidking",
  });

  ledger.record(scope, "https://cdn.example/dead.m3u8");

  expect(ledger.list(scope)).toEqual(["https://cdn.example/dead.m3u8"]);
  expect(
    ledger.list(
      playbackDeadStreamScopeKey({
        titleId: "tmdb:1",
        season: 2,
        episode: 3,
        providerId: "rivestream",
      }),
    ),
  ).toEqual([]);
});

test("dead stream ledger dedupes URLs and can clear a scope", () => {
  const ledger = createDeadStreamUrlLedger();
  const scope = playbackDeadStreamScopeKey({
    titleId: "tmdb:1",
    season: 1,
    episode: 1,
    providerId: "vidking",
  });

  ledger.record(scope, "https://cdn.example/dead.m3u8");
  ledger.record(scope, "https://cdn.example/dead.m3u8");
  ledger.record(scope, "https://cdn.example/other-dead.m3u8");

  expect(ledger.list(scope)).toEqual([
    "https://cdn.example/dead.m3u8",
    "https://cdn.example/other-dead.m3u8",
  ]);

  ledger.clear(scope);

  expect(ledger.list(scope)).toEqual([]);
});
