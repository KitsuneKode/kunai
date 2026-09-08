import { describe, expect, test } from "bun:test";

import {
  RIVESTREAM_CANDIDATE_TIMEOUT_MS,
  RIVESTREAM_RESOLVE_GATE_TIMEOUT_MS,
  rivestreamStreamGateRejection,
} from "../src/rivestream/direct";

/**
 * Rivestream hands out a playlist whose segments live on a third-party CDN that
 * refuses the referer: `master.m3u8` answers 200 while every segment answers
 * `{"code":1004,"error":"domain forbidden"}`. Resolve reported `provider:success`
 * for that, so cycling stopped at the first "working" server and never reached
 * `citadel`, which plays.
 *
 * The gate exists to keep cycling past a stream that is proven dead — and,
 * just as importantly, to keep cycling *past nothing else*. A slow CDN is not a
 * dead one.
 */
describe("rivestream resolve gate", () => {
  test("accepts a reachable stream", () => {
    expect(
      rivestreamStreamGateRejection({ healthy: true, probe: { status: "reachable" } }),
    ).toBeNull();
  });

  test("rejects a definitively unreachable stream so cycling continues", () => {
    const rejection = rivestreamStreamGateRejection({
      healthy: false,
      probe: {
        status: "unreachable",
        reason: "HLS segment unreachable: HTTP 403",
        definitive: true,
      },
    });

    expect(rejection).not.toBeNull();
    expect(rejection?.failureClass).toBe("candidate-blocked");
    expect(rejection?.message).toContain("403");
  });

  test("accepts a stream whose probe timed out", () => {
    // A 3s gate timeout is not evidence of a dead stream. Rejecting here would
    // drop working candidates on slow links, and playback preflight still runs
    // before mpv gets the handoff.
    expect(
      rivestreamStreamGateRejection({ healthy: false, probe: { status: "timeout" } }),
    ).toBeNull();
  });

  test("accepts a stream whose unreachability is not definitive", () => {
    expect(
      rivestreamStreamGateRejection({
        healthy: false,
        probe: { status: "unreachable", reason: "connection reset", definitive: false },
      }),
    ).toBeNull();
  });

  test("accepts when no probe ran at all", () => {
    // Never turn "we learned nothing" into a rejection.
    expect(rivestreamStreamGateRejection({ healthy: false })).toBeNull();
  });
});

describe("resolve gate budget", () => {
  test("the gate fits inside the candidate timeout", () => {
    // A gate that cannot finish inside its candidate's budget is worse than no
    // gate: the probe is cut short, the timeout reads as "not proven dead", and
    // the dead stream is accepted anyway.
    expect(RIVESTREAM_RESOLVE_GATE_TIMEOUT_MS).toBeLessThan(RIVESTREAM_CANDIDATE_TIMEOUT_MS);
  });

  test("the gate outlasts a three-hop HLS probe", () => {
    // An HLS gate is three sequential round trips (master, variant, segment).
    // Measured against Rivestream's dead mirror on 2026-09-08 those totalled
    // 2.1-2.9s, so the old 3s default landed on the edge: the same candidate
    // was rejected on one run and accepted on the next.
    expect(RIVESTREAM_RESOLVE_GATE_TIMEOUT_MS).toBeGreaterThanOrEqual(6_000);
  });
});
