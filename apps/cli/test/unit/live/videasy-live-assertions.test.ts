import { describe, expect, test } from "bun:test";

import {
  VIDEASY_LIVE_FIXTURES,
  VIDEASY_PHASE_A_LABELS,
  evaluateVideasyLiveSmoke,
  extractVideasyProbeOrderLabels,
  isVideasyPhaseAPrefixOrdered,
  isVideasyProbeOrderHealthy,
  resolveVideasyLiveFixtures,
  summarizeVideasySuite,
} from "../../live/videasy-live-assertions";

describe("videasy live assertions", () => {
  test("default fixture is Dutton Ranch (cineby catalog proof)", () => {
    const fixtures = resolveVideasyLiveFixtures({ suite: false });
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.id).toBe("dutton-ranch");
  });

  test("suite returns every registered fixture", () => {
    const fixtures = resolveVideasyLiveFixtures({ suite: true });
    expect(fixtures.map((f) => f.id)).toEqual(VIDEASY_LIVE_FIXTURES.map((f) => f.id));
  });

  test("fixture id selection is case-insensitive", () => {
    expect(resolveVideasyLiveFixtures({ suite: false, fixtureId: "Bloodhounds" })[0]?.id).toBe(
      "bloodhounds",
    );
  });

  test("extracts probe labels from Videasy trace messages", () => {
    const labels = extractVideasyProbeOrderLabels([
      "Started VidKing direct Videasy resolution",
      "Trying Videasy source Neon",
      "Trying Videasy source Cypher",
      "Retrying Yoru with embed referer",
      "Server wings-neon2 did not produce a playable source",
    ]);
    expect(labels).toEqual(["Neon", "Cypher", "Yoru"]);
  });

  test("probe order is healthy when first attempt is Yoru/Cypher/Neon", () => {
    expect(isVideasyProbeOrderHealthy(["Yoru", "Cypher", "Neon"])).toBe(true);
    expect(isVideasyProbeOrderHealthy(["Cypher", "Neon"])).toBe(true);
    expect(isVideasyProbeOrderHealthy(["Neon", "Cypher"])).toBe(true);
    expect(isVideasyProbeOrderHealthy(["Killjoy", "Neon"])).toBe(false);
    expect(isVideasyProbeOrderHealthy([])).toBe(false);
  });

  test("phase A prefix order rejects inverted probes vs resolve order", () => {
    expect(isVideasyPhaseAPrefixOrdered(["Yoru", "Cypher", "Neon"], VIDEASY_PHASE_A_LABELS)).toBe(
      true,
    );
    expect(isVideasyPhaseAPrefixOrdered(["Neon", "Yoru"], VIDEASY_PHASE_A_LABELS)).toBe(false);
  });

  test("evaluateVideasyLiveSmoke passes Yoru-first resolve that lands on Neon", () => {
    const fixture = VIDEASY_LIVE_FIXTURES[0]!;
    const result = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: true,
      streamReachable: true,
      streamCandidates: 3,
      resolveDurationMs: 8_400,
      selectedSourceLabel: "Neon",
      selectedSourceId: "source:videasy:wings-neon2",
      probeOrderLabels: ["Yoru", "Neon"],
      failureCodes: [],
    });
    expect(result.ok).toBe(true);
    expect(result.score).toEqual({
      functional: true,
      performative: true,
      ordered: true,
    });
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  test("evaluateVideasyLiveSmoke hard-fails empty candidates and bad first probe", () => {
    const fixture = VIDEASY_LIVE_FIXTURES[0]!;
    const result = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: false,
      streamReachable: false,
      streamCandidates: 0,
      resolveDurationMs: 12_000,
      selectedSourceLabel: null,
      selectedSourceId: null,
      probeOrderLabels: ["Breach", "Neon"],
      failureCodes: ["not-found"],
    });
    expect(result.ok).toBe(false);
    expect(result.score.functional).toBe(false);
    expect(result.score.ordered).toBe(false);
    expect(result.checks.find((c) => c.id === "stream-candidates")?.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "probe-order-first")?.ok).toBe(false);
  });

  test("soft budget warning does not fail hard ok when under hard budget", () => {
    const fixture = VIDEASY_LIVE_FIXTURES[0]!;
    const result = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: true,
      streamReachable: true,
      streamCandidates: 2,
      resolveDurationMs: fixture.softResolveBudgetMs + 5_000,
      selectedSourceLabel: "Neon",
      selectedSourceId: "source:videasy:wings-neon2",
      probeOrderLabels: ["Neon"],
      failureCodes: [],
    });
    expect(result.hardOk).toBe(true);
    expect(result.softOk).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.score.performative).toBe(false);
  });

  test("hard budget failure fails the smoke unless relaxed", () => {
    const fixture = VIDEASY_LIVE_FIXTURES[0]!;
    const slow = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: true,
      streamReachable: true,
      streamCandidates: 1,
      resolveDurationMs: fixture.hardResolveBudgetMs + 1,
      selectedSourceLabel: "Neon",
      selectedSourceId: "source:videasy:wings-neon2",
      probeOrderLabels: ["Neon"],
      failureCodes: [],
    });
    expect(slow.ok).toBe(false);

    const relaxed = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: true,
      streamReachable: true,
      streamCandidates: 1,
      resolveDurationMs: fixture.hardResolveBudgetMs + 1,
      selectedSourceLabel: "Neon",
      selectedSourceId: "source:videasy:wings-neon2",
      probeOrderLabels: ["Neon"],
      failureCodes: [],
      relaxBudgets: true,
    });
    expect(relaxed.ok).toBe(true);
  });

  test("suite summary aggregates functional/performative/ordered scores", () => {
    const fixture = VIDEASY_LIVE_FIXTURES[0]!;
    const good = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: true,
      streamReachable: true,
      streamCandidates: 2,
      resolveDurationMs: 5_000,
      selectedSourceLabel: "Neon",
      selectedSourceId: "source:videasy:wings-neon2",
      probeOrderLabels: ["Neon"],
      failureCodes: [],
    });
    const bad = evaluateVideasyLiveSmoke({
      fixture,
      streamResolved: false,
      streamReachable: false,
      streamCandidates: 0,
      resolveDurationMs: 5_000,
      selectedSourceLabel: null,
      selectedSourceId: null,
      probeOrderLabels: [],
      failureCodes: ["exhausted"],
    });
    const summary = summarizeVideasySuite([
      { fixtureId: "a", assertion: good },
      { fixtureId: "b", assertion: bad },
    ]);
    expect(summary).toMatchObject({
      ok: false,
      total: 2,
      passed: 1,
      failed: 1,
      functional: 1,
      ordered: 1,
    });
  });
});
