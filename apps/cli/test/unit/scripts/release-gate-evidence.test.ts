import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RELEASE_GATE_NAMES,
  aggregateReleaseGateEvidence,
  createReleaseGateEvidence,
  loadReleaseGateEvidence,
  parseReleaseGateEvidenceDocument,
  validateReleaseGateEvidenceDocument,
  writeReleaseGateEvidence,
  type ReleaseGateArtifact,
  type ReleaseGateEvidenceDocument,
  type ReleaseGateName,
} from "../../../../../scripts/release-gate-evidence";
import { buildReleaseProviderSignoff } from "../../live/release-provider-signoff";

const VERSION = "0.3.0";
const COMMIT_SHA = "abc123def456";
const RUN_ID = "1234567890";
const PROVIDER_RUN_ID = "9876543210";
const NOW_MS = Date.parse("2026-07-23T12:00:00.000Z");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function documentFor(
  gate: ReleaseGateName,
  overrides: Partial<ReleaseGateEvidenceDocument> = {},
): ReleaseGateEvidenceDocument {
  const artifactName = `${gate}-artifact`;
  return {
    schemaVersion: 1,
    gate,
    status: "passed",
    version: VERSION,
    commitSha: COMMIT_SHA,
    runId: gate === "liveProviders" ? PROVIDER_RUN_ID : RUN_ID,
    artifactName,
    artifactSha256: sha256(artifactName),
    generatedAt: "2026-07-23T11:00:00.000Z",
    ...overrides,
  };
}

function completeDocuments(): readonly ReleaseGateEvidenceDocument[] {
  return RELEASE_GATE_NAMES.map((gate) => documentFor(gate));
}

function completeArtifacts(): readonly ReleaseGateArtifact[] {
  return RELEASE_GATE_NAMES.map((gate) => ({
    artifactName: `${gate}-artifact`,
    sha256: sha256(`${gate}-artifact`),
  }));
}

function aggregate(
  documents: readonly ReleaseGateEvidenceDocument[] = completeDocuments(),
  artifacts: readonly ReleaseGateArtifact[] = completeArtifacts(),
) {
  return aggregateReleaseGateEvidence(documents, artifacts, {
    version: VERSION,
    commitSha: COMMIT_SHA,
    runId: RUN_ID,
    providerSignoffRunId: PROVIDER_RUN_ID,
    nowMs: NOW_MS,
  });
}

describe("release gate evidence parsing and aggregation", () => {
  test("accepts one validated document and artifact for every required gate", () => {
    const result = aggregate();

    expect(result.documents.map((document) => document.gate)).toEqual([...RELEASE_GATE_NAMES]);
    expect(result.gates).toEqual(
      Object.fromEntries(RELEASE_GATE_NAMES.map((gate) => [gate, "passed"])) as Record<
        ReleaseGateName,
        "passed"
      >,
    );
    expect(result.version).toBe(VERSION);
    expect(result.commitSha).toBe(COMMIT_SHA);
  });

  test("validates one document against its exact release and artifact identity", () => {
    const document = documentFor("repository");

    expect(
      validateReleaseGateEvidenceDocument(
        document,
        { artifactName: document.artifactName, sha256: document.artifactSha256 },
        {
          version: VERSION,
          commitSha: COMMIT_SHA,
          runId: RUN_ID,
          nowMs: NOW_MS,
        },
      ),
    ).toEqual(document);
    expect(() =>
      validateReleaseGateEvidenceDocument(
        document,
        { artifactName: "wrong-artifact", sha256: document.artifactSha256 },
        {
          version: VERSION,
          commitSha: COMMIT_SHA,
          runId: RUN_ID,
          nowMs: NOW_MS,
        },
      ),
    ).toThrow(/artifact.*identity|artifact.*name/i);
  });

  test("rejects missing and duplicate gates", () => {
    expect(() => aggregate(completeDocuments().slice(1))).toThrow(/missing.*repository/i);
    expect(() => aggregate([...completeDocuments(), documentFor("repository")])).toThrow(
      /duplicate.*repository/i,
    );
  });

  test("rejects unknown gates and non-passed status while parsing", () => {
    expect(() =>
      parseReleaseGateEvidenceDocument({ ...documentFor("repository"), gate: "unknown" }),
    ).toThrow(/unknown.*gate/i);
    expect(() =>
      parseReleaseGateEvidenceDocument({ ...documentFor("repository"), status: "failed" }),
    ).toThrow(/status.*passed/i);
  });

  test("rejects wrong version, commit SHA, and workflow run identity", () => {
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "package" ? { ...document, version: "0.2.6" } : document,
        ),
      ),
    ).toThrow(/package.*version|version.*package/i);
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "installer" ? { ...document, commitSha: "deadbeef" } : document,
        ),
      ),
    ).toThrow(/installer.*sha|sha.*installer/i);
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "repository" ? { ...document, runId: "111" } : document,
        ),
      ),
    ).toThrow(/repository.*run|run.*repository/i);
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "liveProviders" ? { ...document, runId: RUN_ID } : document,
        ),
      ),
    ).toThrow(/liveProviders.*run|run.*liveProviders/i);
  });

  test("rejects malformed and mismatched artifact digests", () => {
    expect(() =>
      parseReleaseGateEvidenceDocument({
        ...documentFor("repository"),
        artifactSha256: "not-a-digest",
      }),
    ).toThrow(/sha-?256|digest/i);
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "compiledPlayback"
            ? { ...document, artifactSha256: "f".repeat(64) }
            : document,
        ),
      ),
    ).toThrow(/compiledPlayback.*digest|digest.*compiledPlayback/i);
  });

  test("rejects missing, duplicate, reused, and unreferenced artifact mappings", () => {
    expect(() => aggregate(completeDocuments(), completeArtifacts().slice(1))).toThrow(
      /artifact.*repository|repository.*artifact/i,
    );
    expect(() =>
      aggregate(completeDocuments(), [...completeArtifacts(), completeArtifacts()[0]!]),
    ).toThrow(/duplicate.*artifact/i);
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "package"
            ? {
                ...document,
                artifactName: "repository-artifact",
                artifactSha256: sha256("repository-artifact"),
              }
            : document,
        ),
      ),
    ).toThrow(/artifact.*more than one|reused|duplicate/i);
    expect(() =>
      aggregate(completeDocuments(), [
        ...completeArtifacts(),
        { artifactName: "unused-artifact", sha256: sha256("unused") },
      ]),
    ).toThrow(/unreferenced.*unused-artifact|unused-artifact.*unreferenced/i);
  });

  test("rejects stale evidence", () => {
    expect(() =>
      aggregate(
        completeDocuments().map((document) =>
          document.gate === "readmeCommands"
            ? { ...document, generatedAt: "2026-07-21T11:59:59.999Z" }
            : document,
        ),
      ),
    ).toThrow(/readmeCommands.*stale|stale.*readmeCommands/i);
  });
});

describe("release gate evidence file loading", () => {
  test("loads evidence paths and directories and hashes every referenced artifact file", () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-release-evidence-"));
    const evidenceDir = join(root, "evidence");
    const artifacts: { artifactName: string; path: string }[] = [];
    mkdirSync(evidenceDir);

    try {
      for (const document of completeDocuments()) {
        const artifactPath = join(root, document.artifactName);
        writeFileSync(artifactPath, document.artifactName, "utf8");
        writeFileSync(join(evidenceDir, `${document.gate}.json`), JSON.stringify(document), "utf8");
        artifacts.push({ artifactName: document.artifactName, path: artifactPath });
      }

      const result = loadReleaseGateEvidence([evidenceDir], artifacts, {
        version: VERSION,
        commitSha: COMMIT_SHA,
        runId: RUN_ID,
        providerSignoffRunId: PROVIDER_RUN_ID,
        nowMs: NOW_MS,
      });
      expect(result.documents).toHaveLength(RELEASE_GATE_NAMES.length);

      expect(() =>
        loadReleaseGateEvidence(
          [evidenceDir],
          artifacts.map((artifact, index) =>
            index === 1 ? { ...artifact, path: artifacts[0]!.path } : artifact,
          ),
          {
            version: VERSION,
            commitSha: COMMIT_SHA,
            runId: RUN_ID,
            providerSignoffRunId: PROVIDER_RUN_ID,
            nowMs: NOW_MS,
          },
        ),
      ).toThrow(/duplicate.*artifact path|artifact path.*more than one/i);

      writeFileSync(artifacts[0]!.path, "tampered", "utf8");
      expect(() =>
        loadReleaseGateEvidence([evidenceDir], artifacts, {
          version: VERSION,
          commitSha: COMMIT_SHA,
          runId: RUN_ID,
          providerSignoffRunId: PROVIDER_RUN_ID,
          nowMs: NOW_MS,
        }),
      ).toThrow(/digest|sha-?256|repository/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("release gate evidence production", () => {
  test("creates and writes passed evidence only after hashing the exact producer artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-release-evidence-create-"));
    const artifactPath = join(root, "repository.log");
    const outputPath = join(root, "repository.json");
    writeFileSync(artifactPath, "repository checks passed\n", "utf8");

    try {
      const document = createReleaseGateEvidence({
        gate: "repository",
        version: VERSION,
        commitSha: COMMIT_SHA,
        runId: RUN_ID,
        artifactName: `repository-${VERSION}-${COMMIT_SHA}`,
        artifactPath,
        generatedAt: "2026-07-23T11:00:00.000Z",
      });
      expect(document.artifactSha256).toBe(sha256("repository checks passed\n"));
      expect(document.status).toBe("passed");

      writeReleaseGateEvidence(outputPath, document);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual(document);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses missing artifacts and mutable artifact names without version and commit", () => {
    expect(() =>
      createReleaseGateEvidence({
        gate: "package",
        version: VERSION,
        commitSha: COMMIT_SHA,
        runId: RUN_ID,
        artifactName: "package-latest",
        artifactPath: "/missing/package.log",
        generatedAt: "2026-07-23T11:00:00.000Z",
      }),
    ).toThrow(/artifact|missing|readable/i);

    const root = mkdtempSync(join(tmpdir(), "kunai-release-evidence-name-"));
    const artifactPath = join(root, "package.log");
    writeFileSync(artifactPath, "ok", "utf8");
    try {
      expect(() =>
        createReleaseGateEvidence({
          gate: "package",
          version: VERSION,
          commitSha: COMMIT_SHA,
          runId: RUN_ID,
          artifactName: "package-latest",
          artifactPath,
          generatedAt: "2026-07-23T11:00:00.000Z",
        }),
      ).toThrow(/artifactName.*version.*commit|immutable/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates liveProviders evidence only for a fresh complete matching signoff", () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-live-provider-evidence-"));
    const artifactPath = join(root, "release-provider-signoff.json");
    const signoff = buildReleaseProviderSignoff({
      generatedAt: "2026-07-23T11:30:00.000Z",
      commitSha: COMMIT_SHA,
      version: VERSION,
      routes: ["movie", "series", "anime"].map((lane) => ({
        lane: lane as "movie" | "series" | "anime",
        configuredProvider: "fixture",
        successfulProvider: "fixture",
        resolved: true,
        streamCandidates: 1,
        streamReachable: true,
        failureClass: null,
        durationMs: 10,
      })),
    });
    writeFileSync(artifactPath, JSON.stringify(signoff), "utf8");

    try {
      expect(
        createReleaseGateEvidence({
          gate: "liveProviders",
          version: VERSION,
          commitSha: COMMIT_SHA,
          runId: PROVIDER_RUN_ID,
          artifactName: `liveProviders-${VERSION}-${COMMIT_SHA}`,
          artifactPath,
          nowMs: NOW_MS,
        }).runId,
      ).toBe(PROVIDER_RUN_ID);

      writeFileSync(
        artifactPath,
        JSON.stringify({ ...signoff, generatedAt: "2026-07-20T00:00:00.000Z" }),
        "utf8",
      );
      expect(() =>
        createReleaseGateEvidence({
          gate: "liveProviders",
          version: VERSION,
          commitSha: COMMIT_SHA,
          runId: PROVIDER_RUN_ID,
          artifactName: `liveProviders-${VERSION}-${COMMIT_SHA}`,
          artifactPath,
          nowMs: NOW_MS,
        }),
      ).toThrow(/stale|unresolved|unreachable/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
