import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REQUIRED_RELEASE_ASSET_NAMES } from "../../../../../scripts/release-asset-contract";
import {
  assertLiveProvidersArtifactBinding,
  evaluateReleaseConfirmation,
  parseReleaseConfirmationCliArgs,
  type ReleaseConfirmationInput,
} from "../../../../../scripts/release-confirmation-gate";
import {
  RELEASE_GATE_NAMES,
  aggregateReleaseGateEvidence,
  type ReleaseGateArtifact,
  type ReleaseGateEvidenceDocument,
  type ReleaseGateName,
} from "../../../../../scripts/release-gate-evidence";
import {
  buildReleaseProviderSignoff,
  type ReleaseProviderSignoffRoute,
} from "../../live/release-provider-signoff";

const REPO_ROOT = join(import.meta.dirname, "../../../../..");
const NOW_MS = Date.parse("2026-07-21T12:00:00.000Z");
const RUN_ID = "1234567890";
const PROVIDER_RUN_ID = "9876543210";

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

function gateDocument(
  gate: ReleaseGateName,
  version: string,
  commitSha: string,
): ReleaseGateEvidenceDocument {
  return {
    schemaVersion: 1,
    gate,
    status: "passed",
    version,
    commitSha,
    runId: gate === "liveProviders" ? PROVIDER_RUN_ID : RUN_ID,
    artifactName:
      gate === "releaseAssets" ? `kunai-release-candidate-${version}` : `${gate}-artifact`,
    artifactSha256: "a".repeat(64),
    generatedAt: "2026-07-21T11:00:00.000Z",
  };
}

function validatedGateEvidence(version: string, commitSha: string) {
  const documents = RELEASE_GATE_NAMES.map((gate) => gateDocument(gate, version, commitSha));
  const artifacts: readonly ReleaseGateArtifact[] = documents.map((document) => ({
    artifactName: document.artifactName,
    sha256: document.artifactSha256,
  }));
  return aggregateReleaseGateEvidence(documents, artifacts, {
    version,
    commitSha,
    runId: RUN_ID,
    providerSignoffRunId: PROVIDER_RUN_ID,
    nowMs: NOW_MS,
  });
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
    providerSignoffRunId: PROVIDER_RUN_ID,
    binaryArtifactName: `kunai-release-candidate-${version}`,
    releaseAssets: completeAssets(),
    targetReleaseMetadata: { version, status: "staged", publishedAt: null },
    release026Metadata: { version: "0.2.6", status: "staged", publishedAt: null },
    trackedInstallerReferencePaths: [],
    generatedMetadataFresh: true,
    gateEvidence: validatedGateEvidence(version, commitSha),
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
    expect(result.evidence.providerSignoffRunId).toBe(PROVIDER_RUN_ID);
    expect(result.evidence.binaryArtifactName).toBe("kunai-release-candidate-0.3.0");
    expect(result.evidence.gates).toEqual(
      Object.fromEntries(RELEASE_GATE_NAMES.map((gate) => [gate, "passed"])) as Record<
        ReleaseGateName,
        "passed"
      >,
    );
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

  test("rejects incomplete release assets", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({
          releaseAssets: completeAssets().filter((asset) => asset.name !== "SHA256SUMS"),
        }),
      ),
    ).toThrow(/missing/i);
  });

  test("rejects release-assets evidence for the wrong candidate artifact", () => {
    expect(() =>
      evaluateReleaseConfirmation(
        validInput({ binaryArtifactName: "different-release-candidate" }),
      ),
    ).toThrow(/releaseAssets.*artifact|artifact.*releaseAssets/i);
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

describe("release confirmation evidence CLI contract", () => {
  test("accepts explicit evidence paths, artifact mappings, and workflow run identity", () => {
    const args = parseReleaseConfirmationCliArgs([
      "--version",
      "0.3.0",
      "--commit",
      "abc123def456",
      "--run-id",
      RUN_ID,
      "--gate-evidence",
      "artifacts/gates/repository.json",
      "--gate-evidence",
      "artifacts/gates/more",
      "--gate-artifact",
      "repository-artifact=artifacts/repository.log",
      "--provider-evidence",
      "artifacts/release-provider-signoff.json",
      "--provider-signoff-run-id",
      PROVIDER_RUN_ID,
      "--binary-dir",
      "apps/cli/dist/bin",
    ]);

    expect(args.runId).toBe(RUN_ID);
    expect(args.gateEvidencePaths).toEqual([
      "artifacts/gates/repository.json",
      "artifacts/gates/more",
    ]);
    expect(args.gateArtifacts).toEqual([
      { artifactName: "repository-artifact", path: "artifacts/repository.log" },
    ]);
  });

  test("binds liveProviders evidence to the provider signoff JSON path", () => {
    const gateEvidence = validatedGateEvidence("0.3.0", "abc123def456");
    const liveProvidersEvidence = gateEvidence.documents.find(
      (document) => document.gate === "liveProviders",
    );
    if (!liveProvidersEvidence) throw new Error("test fixture missing liveProviders evidence");
    const liveProvidersArtifactName = liveProvidersEvidence.artifactName;

    expect(() =>
      assertLiveProvidersArtifactBinding(
        gateEvidence,
        [{ artifactName: liveProvidersArtifactName, path: "/tmp/different.json" }],
        "/tmp/provider-signoff.json",
      ),
    ).toThrow(/liveProviders.*provider signoff/i);
    expect(() =>
      assertLiveProvidersArtifactBinding(
        gateEvidence,
        [{ artifactName: liveProvidersArtifactName, path: "/tmp/provider-signoff.json" }],
        "/tmp/provider-signoff.json",
      ),
    ).not.toThrow();
  });

  test("source never manufactures a hardcoded passed-gate map", () => {
    const source = readFileSync(join(REPO_ROOT, "scripts/release-confirmation-gate.ts"), "utf8");

    expect(source).not.toContain("allPassedGates");
    expect(source).not.toMatch(/declaredGates\s*:\s*\{/);
    expect(source).toContain("loadReleaseGateEvidence");
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
