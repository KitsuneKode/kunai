import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REQUIRED_RELEASE_ASSET_NAMES } from "../../../../../scripts/release-asset-contract";
import {
  RELEASE_CONFIRMATION_GATES,
  evaluateReleaseConfirmation,
  type ReleaseConfirmationInput,
  type ReleaseGateEvidence,
} from "../../../../../scripts/release-confirmation-gate";
import {
  buildReleaseProviderSignoff,
  type ReleaseProviderSignoffRoute,
} from "../../live/release-provider-signoff";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");
const NOW_MS = Date.parse("2026-07-21T12:00:00.000Z");

function baseRoutes(
  overrides: Partial<
    Record<ReleaseProviderSignoffRoute["lane"], Partial<ReleaseProviderSignoffRoute>>
  > = {},
): readonly ReleaseProviderSignoffRoute[] {
  return [
    {
      lane: "movie",
      configuredProvider: "videasy",
      successfulProvider: "videasy",
      resolved: true,
      streamCandidates: 3,
      streamReachable: true,
      failureClass: null,
      durationMs: 1_200,
      ...overrides.movie,
    },
    {
      lane: "series",
      configuredProvider: "videasy",
      successfulProvider: "videasy",
      resolved: true,
      streamCandidates: 2,
      streamReachable: true,
      failureClass: null,
      durationMs: 2_100,
      ...overrides.series,
    },
    {
      lane: "anime",
      configuredProvider: "allanime",
      successfulProvider: "allanime",
      resolved: true,
      streamCandidates: 1,
      streamReachable: true,
      failureClass: null,
      durationMs: 3_400,
      ...overrides.anime,
    },
  ];
}

function passedGates(): ReleaseGateEvidence["gates"] {
  return Object.fromEntries(
    RELEASE_CONFIRMATION_GATES.map((gate) => [gate, "passed"]),
  ) as ReleaseGateEvidence["gates"];
}

function completeAssets(size = 1) {
  return REQUIRED_RELEASE_ASSET_NAMES.map((name) => ({ name, size }));
}

function validInput(overrides: Partial<ReleaseConfirmationInput> = {}): ReleaseConfirmationInput {
  const version = overrides.version ?? "0.3.0";
  const commitSha = overrides.commitSha ?? "abc123def456";
  return {
    version,
    commitSha,
    nowMs: NOW_MS,
    packageVersion: version,
    providerEvidence: buildReleaseProviderSignoff({
      generatedAt: "2026-07-21T06:00:00.000Z",
      commitSha,
      version,
      routes: baseRoutes(),
    }),
    providerSignoffRunId: "9876543210",
    binaryArtifactName: `kunai-release-candidate-${version}`,
    releaseAssets: completeAssets(),
    targetReleaseMetadata: { version, status: "staged", publishedAt: null },
    release026Metadata: { version: "0.2.6", status: "staged", publishedAt: null },
    trackedInstallerReferencePaths: [],
    generatedMetadataFresh: true,
    declaredGates: passedGates(),
    ...overrides,
  };
}

describe("evaluateReleaseConfirmation", () => {
  test("accepts a complete fresh attestation and returns ready-for-confirmation evidence", () => {
    const result = evaluateReleaseConfirmation(validInput());
    expect(result.status).toBe("ready-for-confirmation");
    expect(result.evidence.schemaVersion).toBe(1);
    expect(result.evidence.version).toBe("0.3.0");
    expect(result.evidence.commitSha).toBe("abc123def456");
    expect(result.evidence.providerSignoffRunId).toBe("9876543210");
    expect(result.evidence.binaryArtifactName).toBe("kunai-release-candidate-0.3.0");
    expect(result.evidence.gates).toEqual(passedGates());
    expect(Number.isFinite(Date.parse(result.evidence.generatedAt))).toBe(true);
  });

  test("rejects package version mismatch", () => {
    expect(() => evaluateReleaseConfirmation(validInput({ packageVersion: "0.2.5" }))).toThrow(
      /version mismatch/i,
    );
  });

  test("rejects provider evidence version mismatch", () => {
    const input = validInput();
    expect(() =>
      evaluateReleaseConfirmation({
        ...input,
        providerEvidence: {
          ...input.providerEvidence,
          version: "0.2.5",
        },
      }),
    ).toThrow(/version mismatch/i);
  });

  test("rejects provider evidence SHA mismatch", () => {
    const input = validInput();
    expect(() =>
      evaluateReleaseConfirmation({
        ...input,
        providerEvidence: {
          ...input.providerEvidence,
          commitSha: "deadbeef",
        },
      }),
    ).toThrow(/sha mismatch|commit.*mismatch/i);
  });

  test("rejects provider evidence older than 24h", () => {
    const input = validInput();
    expect(() =>
      evaluateReleaseConfirmation({
        ...input,
        providerEvidence: {
          ...input.providerEvidence,
          generatedAt: "2026-07-19T06:00:00.000Z",
        },
      }),
    ).toThrow(/older than 24h|stale|fresh/i);
  });

  test("rejects missing provider lane", () => {
    const input = validInput();
    expect(() =>
      evaluateReleaseConfirmation({
        ...input,
        providerEvidence: {
          ...input.providerEvidence,
          routes: baseRoutes().slice(0, 2),
        },
      }),
    ).toThrow(/missing.*lane|lane: anime/i);
  });

  test("rejects missing confirmation gate", () => {
    const gates = { ...passedGates() };
    delete (gates as { liveProviders?: "passed" }).liveProviders;
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          declaredGates: gates as ReleaseGateEvidence["gates"],
        }),
      ),
    ).toThrow(/missing.*gate|liveProviders/i);
  });

  test("rejects non-passed confirmation gate", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          declaredGates: {
            ...passedGates(),
            repository: "failed" as "passed",
          },
        }),
      ),
    ).toThrow(/gate.*repository|repository.*passed/i);
  });

  test("rejects incomplete release assets", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          releaseAssets: completeAssets().filter((asset) => asset.name !== "SHA256SUMS"),
        }),
      ),
    ).toThrow(/missing/i);
  });

  test("rejects non-staged target release metadata", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          targetReleaseMetadata: {
            version: "0.3.0",
            status: "published",
            publishedAt: "2026-07-21T00:00:00.000Z",
          },
        }),
      ),
    ).toThrow(/non-staged|must be staged|status.*staged/i);
  });

  test("rejects public 0.2.6", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          release026Metadata: {
            version: "0.2.6",
            status: "published",
            publishedAt: "2026-07-01T00:00:00.000Z",
          },
        }),
      ),
    ).toThrow(/0\.2\.6/i);
  });

  test("rejects tracked installer-reference source", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          trackedInstallerReferencePaths: ["docs/installer-reference/claude-code/01-installer.ts"],
        }),
      ),
    ).toThrow(/installer-reference/i);
  });

  test("rejects generated metadata drift", () => {
    expect(() =>
      evaluateReleaseConfirmation(validInput({ generatedMetadataFresh: false })),
    ).toThrow(/generated|drift|codegen|stale/i);
  });
});

describe("release workflow confirmation dependency graph", () => {
  const release = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");

  function extractWorkflowJob(yaml: string, jobId: string): string {
    const header = new RegExp(`^  ${jobId}:\\s*$`, "m");
    const match = header.exec(yaml);
    if (!match || match.index === undefined) {
      throw new Error(`job "${jobId}" not found in workflow`);
    }
    const start = match.index;
    const after = yaml.slice(start + match[0].length);
    const nextJob = /^  [A-Za-z0-9_-]+:\s*$/m.exec(after);
    const end = nextJob ? start + match[0].length + (nextJob.index ?? 0) : yaml.length;
    return yaml.slice(start, end);
  }

  test("confirmation job sits between candidate and protected publication", () => {
    const confirmation = extractWorkflowJob(release, "confirmation");
    const publish = extractWorkflowJob(release, "publish");

    expect(confirmation).toMatch(/needs:\s*candidate/);
    expect(confirmation).toContain("release:confirmation:check");
    expect(confirmation).toContain("provider_signoff_run_id");
    expect(confirmation).not.toMatch(/environment:\s*release-production/);
    expect(confirmation).not.toContain("bun publish");

    expect(publish).toMatch(/needs:\s*confirmation/);
    expect(publish).toMatch(/environment:\s*release-production/);
    expect(publish).toContain("download-artifact");
    expect(publish).not.toContain("build:binaries");
    expect(publish).not.toContain("bun pm pack");
    expect(publish).not.toContain("bun run build");
  });

  test("workflow_dispatch accepts provider_signoff_run_id", () => {
    expect(release).toMatch(/provider_signoff_run_id:/);
  });
});
