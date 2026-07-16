/**
 * Pure assertions for Videasy live smoke reports.
 * Kept network-free so unit tests can lock the contract without live hosts.
 */

/**
 * Resolve probe order (stable/fast first). Inventory UI still shows Cineby order
 * (Yoru first) via catalogOrder — this list is what source:start traces should follow.
 */
export const VIDEASY_PHASE_A_LABELS = [
  "Neon",
  "Cypher",
  "Yoru",
  "Sage",
  "Jett",
  "Breach",
  "Vyse",
  "Killjoy",
  "Fade",
  "Omen",
  "Raze",
] as const;

/** Acceptable first resolve probes (stable English path). */
export const VIDEASY_CATALOG_LEAD_LABELS = ["Neon", "Cypher", "Yoru"] as const;

/** Known playable English/mirror labels when the API is healthy. */
export const VIDEASY_PREFERRED_ENGLISH_WINNERS = ["Neon", "Cypher", "Yoru", "Sage"] as const;

export type VideasyLiveFixtureId = "dutton-ranch" | "bloodhounds" | "study-group" | "dune";

export type VideasyLiveFixture = {
  readonly id: VideasyLiveFixtureId;
  readonly titleId: string;
  readonly title: string;
  readonly mediaKind: "series" | "movie";
  readonly season?: number;
  readonly episode?: number;
  readonly year?: number;
  /** Labels that are known to produce streams for this title when the API is healthy. */
  readonly knownGoodLabels: readonly string[];
  /** Soft resolve budget (ms). Soft-fail surfaces as warning, not hard fail. */
  readonly softResolveBudgetMs: number;
  /** Hard resolve budget (ms). Exceeding this fails the smoke unless relaxed. */
  readonly hardResolveBudgetMs: number;
};

export const VIDEASY_LIVE_FIXTURES: readonly VideasyLiveFixture[] = [
  {
    id: "dutton-ranch",
    titleId: "299167",
    title: "Dutton Ranch",
    mediaKind: "series",
    season: 1,
    episode: 1,
    year: 2026,
    knownGoodLabels: ["Neon", "Cypher", "Killjoy", "Omen"],
    softResolveBudgetMs: 25_000,
    hardResolveBudgetMs: 90_000,
  },
  {
    id: "bloodhounds",
    titleId: "127529",
    title: "Bloodhounds",
    mediaKind: "series",
    season: 1,
    episode: 2,
    year: 2023,
    knownGoodLabels: ["Neon", "Cypher", "Yoru"],
    softResolveBudgetMs: 25_000,
    hardResolveBudgetMs: 90_000,
  },
  {
    id: "study-group",
    titleId: "233347",
    title: "Study Group",
    mediaKind: "series",
    season: 1,
    episode: 2,
    year: 2025,
    knownGoodLabels: ["Neon", "Cypher", "Yoru"],
    softResolveBudgetMs: 25_000,
    hardResolveBudgetMs: 90_000,
  },
  {
    id: "dune",
    titleId: "438631",
    title: "Dune",
    mediaKind: "movie",
    year: 2021,
    knownGoodLabels: ["Yoru", "Neon", "Cypher"],
    softResolveBudgetMs: 30_000,
    hardResolveBudgetMs: 90_000,
  },
] as const;

export type VideasyLiveAssertionInput = {
  readonly fixture: VideasyLiveFixture;
  readonly streamResolved: boolean;
  readonly streamReachable: boolean;
  readonly streamCandidates: number;
  readonly resolveDurationMs: number | null;
  readonly selectedSourceLabel: string | null;
  readonly selectedSourceId: string | null;
  readonly probeOrderLabels: readonly string[];
  readonly failureCodes: readonly string[];
  readonly relaxBudgets?: boolean;
};

export type VideasyLiveCheck = {
  readonly id: string;
  readonly ok: boolean;
  readonly severity: "hard" | "soft";
  readonly message: string;
};

export type VideasyLiveAssertionResult = {
  readonly ok: boolean;
  readonly hardOk: boolean;
  readonly softOk: boolean;
  readonly checks: readonly VideasyLiveCheck[];
  readonly score: {
    readonly functional: boolean;
    readonly performative: boolean;
    readonly ordered: boolean;
  };
};

/** Parse CLI/env fixture selection. */
export function resolveVideasyLiveFixtures(options: {
  readonly suite: boolean;
  readonly fixtureId?: string | null;
}): readonly VideasyLiveFixture[] {
  if (options.suite) {
    return VIDEASY_LIVE_FIXTURES;
  }
  const wanted = options.fixtureId?.trim().toLowerCase();
  if (wanted) {
    const match = VIDEASY_LIVE_FIXTURES.find((fixture) => fixture.id === wanted);
    if (match) return [match];
  }
  // Default primary: cineby catalog proof title.
  return [VIDEASY_LIVE_FIXTURES[0]!];
}

/**
 * Extract themed server labels from Videasy resolve trace messages.
 * Matches: "Trying Videasy source Neon", "Retrying Cypher with embed referer".
 */
export function extractVideasyProbeOrderLabels(messages: readonly string[]): readonly string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const match =
      message.match(/Trying Videasy source\s+(.+?)\s*$/i) ??
      message.match(/Retrying\s+(.+?)\s+with embed referer/i) ??
      message.match(/Videasy source\s+(.+?)\s+failed/i);
    if (!match?.[1]) continue;
    const label = match[1].trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

/** True when the first probe follows the website catalog lead (Yoru / next English rows). */
export function isVideasyProbeOrderHealthy(
  probeOrderLabels: readonly string[],
  preferred: readonly string[] = VIDEASY_CATALOG_LEAD_LABELS,
): boolean {
  if (probeOrderLabels.length === 0) return false;
  const first = probeOrderLabels[0];
  if (!first) return false;
  return preferred.includes(first);
}

/** Phase A prefix: probes must not invert the Cineby catalog rank among known labels. */
export function isVideasyPhaseAPrefixOrdered(
  probeOrderLabels: readonly string[],
  phaseA: readonly string[] = VIDEASY_PHASE_A_LABELS,
): boolean {
  if (probeOrderLabels.length === 0) return false;
  const rank = new Map(phaseA.map((label, index) => [label, index]));
  let lastRank = -1;
  for (const label of probeOrderLabels) {
    const current = rank.get(label);
    if (current === undefined) continue; // unknown/legacy labels ignored
    if (current < lastRank) return false;
    lastRank = current;
  }
  return lastRank >= 0;
}

export function evaluateVideasyLiveSmoke(
  input: VideasyLiveAssertionInput,
): VideasyLiveAssertionResult {
  const checks: VideasyLiveCheck[] = [];

  const functionalStream = input.streamResolved && input.streamReachable;
  checks.push({
    id: "stream-resolved-reachable",
    ok: functionalStream,
    severity: "hard",
    message: functionalStream
      ? "Resolved a reachable stream"
      : `Stream not playable (resolved=${input.streamResolved}, reachable=${input.streamReachable})`,
  });

  const hasCandidates = input.streamCandidates > 0;
  checks.push({
    id: "stream-candidates",
    ok: hasCandidates,
    severity: "hard",
    message: hasCandidates
      ? `Provider returned ${input.streamCandidates} stream candidate(s)`
      : "Provider returned zero stream candidates (decrypt/route failure likely)",
  });

  const winnerOk =
    !input.selectedSourceLabel ||
    input.fixture.knownGoodLabels.includes(input.selectedSourceLabel) ||
    VIDEASY_PREFERRED_ENGLISH_WINNERS.includes(
      input.selectedSourceLabel as (typeof VIDEASY_PREFERRED_ENGLISH_WINNERS)[number],
    );
  checks.push({
    id: "selected-source-plausible",
    ok: winnerOk,
    severity: "soft",
    message: input.selectedSourceLabel
      ? winnerOk
        ? `Selected source "${input.selectedSourceLabel}" is a known-good/catalog winner`
        : `Selected source "${input.selectedSourceLabel}" is outside known-good set for ${input.fixture.id}`
      : "No selected source label (inventory may be sparse)",
  });

  const firstProbeOk = isVideasyProbeOrderHealthy(input.probeOrderLabels);
  checks.push({
    id: "probe-order-first",
    ok: firstProbeOk,
    severity: "hard",
    message: firstProbeOk
      ? `First probe is stable-first (${input.probeOrderLabels[0]})`
      : `First probe should be Neon/Cypher/Yoru; got ${input.probeOrderLabels[0] ?? "(none)"}`,
  });

  const phaseAOrdered = isVideasyPhaseAPrefixOrdered(input.probeOrderLabels);
  checks.push({
    id: "probe-order-phase-a",
    ok: phaseAOrdered,
    severity: "soft",
    message: phaseAOrdered
      ? "Probe order respects stable-first Phase A among known labels"
      : `Probe order drifts from stable-first Phase A: ${input.probeOrderLabels.join(" → ") || "(empty)"}`,
  });

  const duration = input.resolveDurationMs;
  const withinHard =
    duration === null
      ? false
      : input.relaxBudgets
        ? true
        : duration <= input.fixture.hardResolveBudgetMs;
  checks.push({
    id: "resolve-budget-hard",
    ok: withinHard,
    severity: "hard",
    message:
      duration === null
        ? "Missing resolveDurationMs"
        : withinHard
          ? `Resolve finished in ${duration}ms (hard budget ${input.fixture.hardResolveBudgetMs}ms)`
          : `Resolve took ${duration}ms > hard budget ${input.fixture.hardResolveBudgetMs}ms`,
  });

  const withinSoft = duration !== null && duration <= input.fixture.softResolveBudgetMs;
  checks.push({
    id: "resolve-budget-soft",
    ok: withinSoft,
    severity: "soft",
    message:
      duration === null
        ? "Missing resolveDurationMs"
        : withinSoft
          ? `Resolve is performative (${duration}ms ≤ soft ${input.fixture.softResolveBudgetMs}ms)`
          : `Resolve is slow (${duration}ms > soft ${input.fixture.softResolveBudgetMs}ms)`,
  });

  const hardOk = checks.filter((c) => c.severity === "hard").every((c) => c.ok);
  const softOk = checks.filter((c) => c.severity === "soft").every((c) => c.ok);

  return {
    ok: hardOk,
    hardOk,
    softOk,
    checks,
    score: {
      functional: functionalStream && hasCandidates,
      performative: withinSoft && withinHard,
      ordered: firstProbeOk && phaseAOrdered,
    },
  };
}

export function summarizeVideasySuite(
  fixtureResults: readonly {
    readonly fixtureId: string;
    readonly assertion: VideasyLiveAssertionResult;
  }[],
): {
  readonly ok: boolean;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly functional: number;
  readonly performative: number;
  readonly ordered: number;
} {
  const passed = fixtureResults.filter((row) => row.assertion.ok).length;
  return {
    ok: passed === fixtureResults.length && fixtureResults.length > 0,
    total: fixtureResults.length,
    passed,
    failed: fixtureResults.length - passed,
    functional: fixtureResults.filter((row) => row.assertion.score.functional).length,
    performative: fixtureResults.filter((row) => row.assertion.score.performative).length,
    ordered: fixtureResults.filter((row) => row.assertion.score.ordered).length,
  };
}
