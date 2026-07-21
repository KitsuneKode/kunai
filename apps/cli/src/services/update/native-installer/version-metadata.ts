import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

import { parseCanonicalVersion } from "../version";
import { versionBinaryPath, versionMetadataPath, type InstallLayoutPaths } from "./install-layout";

export interface InstalledVersionMetadata {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly target: string;
  readonly artifactName: string;
  readonly artifactSha256: string;
  readonly sizeBytes: number;
  readonly sourceUrl: string;
  readonly verification: "release-checksum" | "legacy-unverified";
  readonly installedAt: string;
}

export type VerifyStoredVersionResult =
  | { readonly status: "verified"; readonly metadata: InstalledVersionMetadata }
  | {
      readonly status:
        | "missing-binary"
        | "missing-metadata"
        | "invalid-metadata"
        | "untrusted-metadata"
        | "size-mismatch"
        | "checksum-mismatch";
      readonly detail: string;
    };

const VERIFICATIONS = new Set(["release-checksum", "legacy-unverified"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseMetadata(raw: unknown): InstalledVersionMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) return null;
  if (!isNonEmptyString(value.version) || !parseCanonicalVersion(value.version)) return null;
  if (!isNonEmptyString(value.target)) return null;
  if (!isNonEmptyString(value.artifactName)) return null;
  if (!isNonEmptyString(value.artifactSha256) || !/^[a-fA-F0-9]{64}$/.test(value.artifactSha256)) {
    return null;
  }
  if (
    typeof value.sizeBytes !== "number" ||
    !Number.isFinite(value.sizeBytes) ||
    value.sizeBytes < 0
  ) {
    return null;
  }
  if (!isNonEmptyString(value.sourceUrl)) return null;
  if (typeof value.verification !== "string" || !VERIFICATIONS.has(value.verification)) {
    return null;
  }
  if (!isNonEmptyString(value.installedAt) || Number.isNaN(Date.parse(value.installedAt))) {
    return null;
  }

  return {
    schemaVersion: 1,
    version: value.version,
    target: value.target,
    artifactName: value.artifactName,
    artifactSha256: value.artifactSha256.toLowerCase(),
    sizeBytes: value.sizeBytes,
    sourceUrl: value.sourceUrl,
    verification: value.verification as InstalledVersionMetadata["verification"],
    installedAt: value.installedAt,
  };
}

export async function writeInstalledVersionMetadata(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
  metadata: InstalledVersionMetadata,
): Promise<void> {
  const canonical = parseCanonicalVersion(metadata.version);
  if (!canonical) {
    throw new Error(`Invalid install version for metadata: ${metadata.version}`);
  }
  if (metadata.schemaVersion !== 1) {
    throw new Error(`Unsupported version metadata schema: ${metadata.schemaVersion}`);
  }
  const path = versionMetadataPath(layout, canonical);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomicJson(path, {
    ...metadata,
    version: canonical,
    artifactSha256: metadata.artifactSha256.toLowerCase(),
  });
}

export async function verifyStoredVersion(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
  version: string,
): Promise<VerifyStoredVersionResult> {
  const canonical = parseCanonicalVersion(version);
  if (!canonical) {
    return { status: "invalid-metadata", detail: `Invalid version: ${version}` };
  }

  const binaryPath = versionBinaryPath(layout, canonical);
  if (!existsSync(binaryPath)) {
    return { status: "missing-binary", detail: `Missing binary at ${binaryPath}` };
  }

  const metadataPath = versionMetadataPath(layout, canonical);
  if (!existsSync(metadataPath)) {
    return { status: "missing-metadata", detail: `Missing metadata at ${metadataPath}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    return { status: "invalid-metadata", detail: "Metadata is not valid JSON" };
  }

  const metadata = parseMetadata(parsed);
  if (!metadata) {
    return { status: "invalid-metadata", detail: "Metadata failed schema validation" };
  }
  if (metadata.version !== canonical) {
    return {
      status: "invalid-metadata",
      detail: `Metadata version ${metadata.version} does not match ${canonical}`,
    };
  }

  if (metadata.verification !== "release-checksum") {
    return {
      status: "untrusted-metadata",
      detail: `Verification mode ${metadata.verification} is not rollback-trusted`,
    };
  }

  const fileStat = await stat(binaryPath);
  if (fileStat.size !== metadata.sizeBytes) {
    return {
      status: "size-mismatch",
      detail: `Expected ${metadata.sizeBytes} bytes, found ${fileStat.size}`,
    };
  }

  const bytes = new Uint8Array(await Bun.file(binaryPath).arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== metadata.artifactSha256.toLowerCase()) {
    return {
      status: "checksum-mismatch",
      detail: `Expected ${metadata.artifactSha256}, found ${actual}`,
    };
  }

  return { status: "verified", metadata };
}
