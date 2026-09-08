import { describe, expect, test } from "bun:test";

import { ALLMANGA_CANDIDATE_TIMEOUT_MS } from "../src/allmanga/direct";
import {
  RIVESTREAM_CANDIDATE_TIMEOUT_MS,
  RIVESTREAM_RESOLVE_GATE_TIMEOUT_MS,
} from "../src/rivestream/direct";
import { STREAM_HEALTH_DEFAULTS } from "../src/shared/stream-health";

/**
 * A resolve gate that cannot finish is worse than no gate.
 *
 * An HLS gate is three sequential round trips — master playlist, variant
 * playlist, first segment. Measured against a live dead mirror on 2026-09-08
 * those totalled 2.1-2.9s. A probe cut short reports `timeout`, and
 * `isStreamReachableForResolve` deliberately treats a timeout as "not proven
 * dead" so a slow CDN is not mistaken for a broken one — which means an
 * under-budgeted gate does not fail loudly, it silently passes dead streams,
 * and it does so intermittently.
 *
 * Rivestream demonstrated exactly that at the old 3s default: the same
 * candidate was rejected on one run and accepted on the next.
 */
const OBSERVED_THREE_HOP_PROBE_MS = 2_900;

describe("resolve gate budgets", () => {
  test("the shared gate outlasts a three-hop HLS probe with headroom", () => {
    // Headroom, not a hair over: the old 3s default cleared the measured 2.9s
    // by 100ms and still flipped its verdict between consecutive runs. Anything
    // this close to the observed cost is a coin toss on a slower link.
    expect(STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs).toBeGreaterThanOrEqual(
      OBSERVED_THREE_HOP_PROBE_MS * 2,
    );
  });

  test("there is one gate budget, not a per-provider copy to drift", () => {
    // Videasy used to carry its own 2.5s budget — tighter than the shared
    // default and tighter than a probe can complete in.
    expect(STREAM_HEALTH_DEFAULTS).not.toHaveProperty("vidkingResolveGateTimeoutMs");
  });

  test.each([
    ["rivestream", RIVESTREAM_RESOLVE_GATE_TIMEOUT_MS, RIVESTREAM_CANDIDATE_TIMEOUT_MS],
    ["allmanga", STREAM_HEALTH_DEFAULTS.resolveGateTimeoutMs, ALLMANGA_CANDIDATE_TIMEOUT_MS],
  ])("%s's gate fits inside its candidate timeout", (_provider, gateMs, candidateMs) => {
    // A gate that cannot finish inside its own candidate's budget is cut short,
    // reports `timeout`, and is let through — so an under-sized candidate
    // timeout silently disables the gate rather than failing loudly.
    expect(gateMs).toBeLessThan(candidateMs);
  });

  test("the preflight budget stays lenient and separate", () => {
    // Preflight is the last-chance check before mpv and is deliberately
    // permissive; it is not a cycling decision, so it does not need the
    // headroom a resolve gate does.
    expect(STREAM_HEALTH_DEFAULTS.preflightTimeoutMs).toBeGreaterThan(0);
  });
});
