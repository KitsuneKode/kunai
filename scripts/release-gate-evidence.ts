import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const RELEASE_GATE_NAMES = [
  "repository",
  "package",
  "installer",
  "npmGlobalInstall",
  "compiledPlayback",
  "readmeCommands",
  "liveProviders",
  "releaseAssets",
  "nativePlatforms",
] as const;

export type ReleaseGateName = (typeof RELEASE_GATE_NAMES)[number];

export interface ReleaseGateEvidenceDocument {
  schemaVersion: 1;
  gate: ReleaseGateName;
  status: "passed";
  version: string;
  commitSha: string;
  runId: string;
  artifactName: string;
  artifactSha256: string;
  generatedAt: string;
}

export interface ReleaseGateArtifact {
  readonly artifactName: string;
  readonly sha256: string;
}

export interface ReleaseGateArtifactPath {
  readonly artifactName: string;
  readonly path: string;
}

export interface ReleaseGateEvidenceExpectations {
  readonly version: string;
  readonly commitSha: string;
  readonly runId: string;
  readonly providerSignoffRunId: string;
  readonly nowMs: number;
}

export interface ReleaseGateEvidenceDocumentExpectations {
  readonly version: string;
  readonly commitSha: string;
  readonly runId: string;
  readonly nowMs: number;
}

export interface ValidatedReleaseGateEvidence {
  readonly version: string;
  readonly commitSha: string;
  readonly documents: readonly ReleaseGateEvidenceDocument[];
  readonly gates: Readonly<Record<ReleaseGateName, "passed">>;
}

const DOCUMENT_KEYS = [
  "schemaVersion",
  "gate",
  "status",
  "version",
  "commitSha",
  "runId",
  "artifactName",
  "artifactSha256",
  "generatedAt",
] as const;
const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const RUN_ID_PATTERN = /^[1-9]\d*$/;

function fail(message: string): never {
  throw new Error(`[release-evidence] ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(
  input: Record<string, unknown>,
  key: keyof ReleaseGateEvidenceDocument,
): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(`${key} must be a non-empty string without surrounding whitespace`);
  }
  return value;
}

function isValidPackageVersion(value: string): boolean {
  const identifier = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
  const prerelease = `(?:-${identifier}(?:\\.${identifier})*)?`;
  const build = "(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?";
  return new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)${prerelease}${build}$`).test(
    value,
  );
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`could not parse evidence file ${path}: ${message}`);
  }
}

function listEvidenceFiles(path: string): readonly string[] {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`evidence path is not readable: ${path}: ${message}`);
  }
  if (stats.isFile()) return [path];
  if (!stats.isDirectory()) fail(`evidence path must be a file or directory: ${path}`);

  const files = readdirSync(path)
    .filter((name) => name.endsWith(".json"))
    .map((name) => resolve(path, name))
    .filter((candidate) => statSync(candidate).isFile())
    .sort();
  if (files.length === 0) fail(`evidence directory contains no JSON documents: ${path}`);
  return files;
}

function sha256File(path: string): string {
  try {
    if (!statSync(path).isFile()) fail(`artifact path must be a file: ${path}`);
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[release-evidence]")) throw error;
    const message = error instanceof Error ? error.message : String(error);
    fail(`artifact file is not readable: ${path}: ${message}`);
  }
}

export function parseReleaseGateEvidenceDocument(input: unknown): ReleaseGateEvidenceDocument {
  if (!isObject(input)) fail("evidence document must be a JSON object");

  const unexpected = Object.keys(input).filter(
    (key) => !DOCUMENT_KEYS.includes(key as (typeof DOCUMENT_KEYS)[number]),
  );
  if (unexpected.length > 0)
    fail(`evidence document has unexpected fields: ${unexpected.join(", ")}`);
  const missing = DOCUMENT_KEYS.filter((key) => !Object.hasOwn(input, key));
  if (missing.length > 0) fail(`evidence document is missing fields: ${missing.join(", ")}`);

  if (input.schemaVersion !== 1)
    fail(`schemaVersion must be 1 (got ${String(input.schemaVersion)})`);

  const gate = requireNonEmptyString(input, "gate");
  if (!RELEASE_GATE_NAMES.includes(gate as ReleaseGateName)) fail(`unknown release gate: ${gate}`);
  if (input.status !== "passed") {
    fail(`gate ${gate} status must be passed (got ${String(input.status)})`);
  }

  const version = requireNonEmptyString(input, "version");
  if (!isValidPackageVersion(version)) fail(`gate ${gate} has invalid version: ${version}`);
  const commitSha = requireNonEmptyString(input, "commitSha");
  if (!COMMIT_SHA_PATTERN.test(commitSha)) fail(`gate ${gate} has malformed commit SHA`);
  const runId = requireNonEmptyString(input, "runId");
  if (!RUN_ID_PATTERN.test(runId)) fail(`gate ${gate} has malformed run ID`);
  const artifactName = requireNonEmptyString(input, "artifactName");
  const artifactSha256 = requireNonEmptyString(input, "artifactSha256");
  if (!SHA256_PATTERN.test(artifactSha256)) {
    fail(`gate ${gate} artifactSha256 must be a lowercase 64-character SHA-256 digest`);
  }
  const generatedAt = requireNonEmptyString(input, "generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt)))
    fail(`gate ${gate} generatedAt is not a valid date`);

  return {
    schemaVersion: 1,
    gate: gate as ReleaseGateName,
    status: "passed",
    version,
    commitSha,
    runId,
    artifactName,
    artifactSha256,
    generatedAt,
  };
}

export function validateReleaseGateEvidenceDocument(
  input: unknown,
  artifact: ReleaseGateArtifact,
  expectations: ReleaseGateEvidenceDocumentExpectations,
): ReleaseGateEvidenceDocument {
  const document = parseReleaseGateEvidenceDocument(input);
  const gate = document.gate;
  if (document.version !== expectations.version) {
    fail(
      `gate ${gate} version mismatch: expected ${expectations.version}, got ${document.version}`,
    );
  }
  if (document.commitSha !== expectations.commitSha) {
    fail(
      `gate ${gate} commit SHA mismatch: expected ${expectations.commitSha}, got ${document.commitSha}`,
    );
  }
  if (document.runId !== expectations.runId) {
    fail(`gate ${gate} run ID mismatch: expected ${expectations.runId}, got ${document.runId}`);
  }
  if (artifact.artifactName !== document.artifactName) {
    fail(
      `gate ${gate} artifact identity mismatch: expected ${document.artifactName}, got ${artifact.artifactName}`,
    );
  }
  if (!SHA256_PATTERN.test(artifact.sha256)) {
    fail(`artifact ${artifact.artifactName} has a malformed SHA-256 digest`);
  }
  if (artifact.sha256 !== document.artifactSha256) {
    fail(
      `gate ${gate} artifact digest mismatch for ${document.artifactName}: expected ${document.artifactSha256}, got ${artifact.sha256}`,
    );
  }

  const generatedAtMs = Date.parse(document.generatedAt);
  if (!Number.isFinite(expectations.nowMs)) fail("nowMs must be finite");
  if (generatedAtMs > expectations.nowMs) fail(`gate ${gate} generatedAt is in the future`);
  if (expectations.nowMs - generatedAtMs > MAX_EVIDENCE_AGE_MS) {
    fail(`gate ${gate} evidence is stale (older than 24h)`);
  }
  return document;
}

export function aggregateReleaseGateEvidence(
  documents: readonly ReleaseGateEvidenceDocument[],
  artifacts: readonly ReleaseGateArtifact[],
  expectations: ReleaseGateEvidenceExpectations,
): ValidatedReleaseGateEvidence {
  if (!isValidPackageVersion(expectations.version)) fail("expected version is invalid");
  if (!COMMIT_SHA_PATTERN.test(expectations.commitSha)) fail("expected commit SHA is malformed");
  if (!RUN_ID_PATTERN.test(expectations.runId)) fail("expected workflow run ID is malformed");
  if (!RUN_ID_PATTERN.test(expectations.providerSignoffRunId)) {
    fail("expected provider signoff run ID is malformed");
  }
  if (!Number.isFinite(expectations.nowMs)) fail("nowMs must be finite");

  const artifactByName = new Map<string, string>();
  for (const artifact of artifacts) {
    if (!artifact.artifactName.trim() || artifact.artifactName.trim() !== artifact.artifactName) {
      fail("artifact mapping name must be a non-empty string without surrounding whitespace");
    }
    if (!SHA256_PATTERN.test(artifact.sha256)) {
      fail(`artifact ${artifact.artifactName} has a malformed SHA-256 digest`);
    }
    if (artifactByName.has(artifact.artifactName)) {
      fail(`duplicate artifact mapping: ${artifact.artifactName}`);
    }
    artifactByName.set(artifact.artifactName, artifact.sha256);
  }

  const documentByGate = new Map<ReleaseGateName, ReleaseGateEvidenceDocument>();
  const gateByArtifact = new Map<string, ReleaseGateName>();
  for (const input of documents) {
    const parsed = parseReleaseGateEvidenceDocument(input);
    const gate = parsed.gate;
    if (documentByGate.has(gate)) fail(`duplicate release gate evidence: ${gate}`);
    const expectedRunId =
      gate === "liveProviders" ? expectations.providerSignoffRunId : expectations.runId;
    const actualDigest = artifactByName.get(parsed.artifactName);
    if (!actualDigest) {
      fail(`gate ${gate} references missing artifact mapping: ${parsed.artifactName}`);
    }
    const document = validateReleaseGateEvidenceDocument(
      parsed,
      { artifactName: parsed.artifactName, sha256: actualDigest },
      {
        version: expectations.version,
        commitSha: expectations.commitSha,
        runId: expectedRunId,
        nowMs: expectations.nowMs,
      },
    );
    const priorGate = gateByArtifact.get(document.artifactName);
    if (priorGate) {
      fail(
        `artifact ${document.artifactName} is reused by more than one gate: ${priorGate}, ${gate}`,
      );
    }

    documentByGate.set(gate, document);
    gateByArtifact.set(document.artifactName, gate);
  }

  for (const gate of RELEASE_GATE_NAMES) {
    if (!documentByGate.has(gate)) fail(`missing required release gate evidence: ${gate}`);
  }
  const unreferencedArtifacts = [...artifactByName.keys()].filter(
    (artifactName) => !gateByArtifact.has(artifactName),
  );
  if (unreferencedArtifacts.length > 0) {
    fail(`unreferenced artifact mappings: ${unreferencedArtifacts.join(", ")}`);
  }

  const orderedDocuments = RELEASE_GATE_NAMES.map((gate) => {
    const document = documentByGate.get(gate);
    if (!document) fail(`missing required release gate evidence: ${gate}`);
    return document;
  });
  const gates = Object.fromEntries(
    orderedDocuments.map((document) => [document.gate, document.status]),
  ) as Record<ReleaseGateName, "passed">;
  return {
    version: expectations.version,
    commitSha: expectations.commitSha,
    documents: orderedDocuments,
    gates,
  };
}

export function loadReleaseGateEvidence(
  evidencePaths: readonly string[],
  artifacts: readonly ReleaseGateArtifactPath[],
  expectations: ReleaseGateEvidenceExpectations,
): ValidatedReleaseGateEvidence {
  if (evidencePaths.length === 0) fail("at least one evidence file or directory is required");
  const resolvedEvidenceFiles = evidencePaths.flatMap((path) => listEvidenceFiles(resolve(path)));
  const documents = resolvedEvidenceFiles.map((path) =>
    parseReleaseGateEvidenceDocument(parseJsonFile(path)),
  );
  const artifactNameByPath = new Map<string, string>();
  const hashedArtifacts = artifacts.map((artifact) => {
    const artifactPath = resolve(artifact.path);
    const priorArtifactName = artifactNameByPath.get(artifactPath);
    if (priorArtifactName) {
      fail(
        `duplicate artifact path ${artifactPath} is mapped by more than one name: ${priorArtifactName}, ${artifact.artifactName}`,
      );
    }
    artifactNameByPath.set(artifactPath, artifact.artifactName);
    return {
      artifactName: artifact.artifactName,
      sha256: sha256File(artifactPath),
    };
  });
  return aggregateReleaseGateEvidence(documents, hashedArtifacts, expectations);
}
