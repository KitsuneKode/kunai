import { expect, test } from "bun:test";

import { releaseAvailabilityFixture } from "../../helpers/release-signoff";
import { buildReleaseProviderRouteCases } from "../../live/release-provider-routes";
import {
  assertReleaseProviderSignoffComplete,
  buildReleaseAvailabilityDiagnostic,
  isReleaseProviderSignoffAcceptable,
  type ReleaseAvailabilityDiagnostic,
  type ReleaseProviderSignoff,
  type ReleaseProviderSignoffRoute,
} from "../../live/release-provider-signoff";

const generatedAt = "2026-10-28T12:00:00.000Z";
const nowMs = Date.parse(generatedAt) + 60_000;

function fixture() {
  return {
    schemaVersion: 2 as const,
    generatedAt,
    commitSha: "a".repeat(40),
    version: "0.4.0",
    routes: (
      [
        ["movie", "27205", "Inception", "vidlink"],
        ["movie", "550", "Fight Club", "vidlink"],
        ["series", "299167", "Dutton Ranch", "vidlink"],
        ["anime", "search:Onigiri", "Onigiri", "hianime"],
      ] as const
    ).map(([lane, targetId, targetTitle, provider]): ReleaseProviderSignoffRoute => ({
      lane,
      targetId,
      targetTitle,
      configuredProvider: provider,
      successfulProvider: provider,
      resolved: true,
      streamCandidates: 1,
      streamReachable: true,
      failureClass: null,
      durationMs: 100,
    })),
    diagnostics: releaseAvailabilityFixture("vidlink"),
  };
}

function acceptable(value: ReturnType<typeof fixture>): boolean {
  return isReleaseProviderSignoffAcceptable(value, nowMs);
}

test("schema 2 requires both movie controls and an honest absence diagnostic", () => {
  expect(acceptable(fixture())).toBe(true);
  const routes = buildReleaseProviderRouteCases({ provider: "vidlink", animeProvider: "hianime" }, [
    "vidlink",
    "hianime",
  ]);
  expect(
    routes
      .filter((route) => route.lane === "movie")
      .map((route) => ("title" in route ? route.title.id : "")),
  ).toEqual(["27205", "550"]);
});

test("legacy schema and a missing or duplicated control fail closed", () => {
  const complete = fixture();
  for (const invalid of [
    { ...complete, schemaVersion: 1 },
    { ...complete, routes: complete.routes.slice(1) },
    { ...complete, routes: [...complete.routes, ...complete.routes.slice(0, 1)] },
    { ...complete, diagnostics: [] },
  ]) {
    // SAFETY: Deliberately malformed evidence exercises validation of legacy and incomplete JSON.
    const malformed = invalid as ReleaseProviderSignoff;
    expect(() => assertReleaseProviderSignoffComplete(malformed)).toThrow();
  }
});

test("fallback substitution, unprobed streams and zero candidates cannot qualify a control", () => {
  for (const patch of [
    { successfulProvider: "rivestream" },
    { streamReachable: null },
    { streamCandidates: 0 },
  ]) {
    const report = fixture();
    report.routes[0] = { ...report.routes[0]!, ...patch };
    expect(acceptable(report)).toBe(false);
  }
});

test("unverified absence, network failures and inconsistent absence never pass", () => {
  for (const patch of [
    { verifiedNotFound: false },
    { failureClass: "environment-network" },
    { resolved: true },
    { streamCandidates: 1 },
    { streamReachable: true },
    { provider: "other" },
    { status: "failed" },
  ] satisfies Partial<ReleaseAvailabilityDiagnostic>[]) {
    const report = fixture();
    report.diagnostics[0] = { ...report.diagnostics[0]!, ...patch };
    expect(acceptable(report)).toBe(false);
  }
});

test("restored catalog availability requires a reachable stream instead of pretending absence", () => {
  const report = fixture();
  report.diagnostics[0] = {
    ...report.diagnostics[0]!,
    status: "available",
    verifiedNotFound: false,
    resolved: true,
    streamCandidates: 1,
    streamReachable: true,
  };
  expect(acceptable(report)).toBe(true);
  report.diagnostics[0] = { ...report.diagnostics[0]!, streamReachable: false };
  expect(acceptable(report)).toBe(false);
});

test("diagnostic construction requires explicit absence evidence and uncontaminated failures", () => {
  const route: ReleaseProviderSignoffRoute = {
    ...fixture().routes[0]!,
    targetId: "438631",
    targetTitle: "Dune",
    successfulProvider: null,
    resolved: false,
    streamCandidates: 0,
    streamReachable: null,
    failureClass: "provider-drift",
  };
  const observation = { route, failureCodes: ["not-found"], catalogAbsenceObserved: true };
  expect(buildReleaseAvailabilityDiagnostic(observation)).toMatchObject({
    status: "not-found",
    verifiedNotFound: true,
    failureClass: null,
  });
  for (const invalid of [
    { ...observation, catalogAbsenceObserved: false },
    { ...observation, failureCodes: [] },
    { ...observation, failureCodes: ["not-found", "network-error"] },
    { ...observation, route: { ...route, failureClass: "environment-network" as const } },
  ]) {
    expect(buildReleaseAvailabilityDiagnostic(invalid)).toMatchObject({
      status: "failed",
      verifiedNotFound: false,
    });
  }
});
