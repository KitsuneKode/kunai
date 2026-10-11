import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { writeAtomicJson } from "@/infra/fs/atomic-write";

import type { InstallManifest } from "../install-manifest";
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
  readonly archiveName?: string;
  readonly archiveSha256?: string;
  readonly archiveSizeBytes?: number;
  readonly archiveSourceUrl?: string;
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

type MutableMetadata = {
  -readonly [K in keyof InstalledVersionMetadata]: InstalledVersionMetadata[K];
};

type MetadataRecord = {
  readonly schemaVersion?: unknown;
  readonly version?: unknown;
  readonly target?: unknown;
  readonly artifactName?: unknown;
  readonly artifactSha256?: unknown;
  readonly sizeBytes?: unknown;
  readonly sourceUrl?: unknown;
  readonly archiveName?: unknown;
  readonly archiveSha256?: unknown;
  readonly archiveSizeBytes?: unknown;
  readonly archiveSourceUrl?: unknown;
  readonly verification?: unknown;
  readonly installedAt?: unknown;
};

function isObjectLike<T>(value: T): value is T & object {
  return value !== null && !Array.isArray(value) && value instanceof Object;
}

function isStringValue<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isNonEmptyString<T>(value: T): value is T & string {
  return isStringValue(value) && value.length > 0;
}

function isSha256Value<T>(value: T): value is T & string {
  return isStringValue(value) && /^[a-fA-F0-9]{64}$/.test(value);
}

function isPositiveSafeInteger<T>(value: T): value is T & number {
  // SAFETY: Number.isSafeInteger has already rejected every non-number value.
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonNegativeFinite<T>(value: T): value is T & number {
  // SAFETY: Number.isFinite has already rejected every non-number value.
  return Number.isFinite(value) && (value as number) >= 0;
}

function isNumberValue<T>(value: T): value is T & number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

function archiveProvenanceIsValid(value: MetadataRecord): boolean {
  const fields = [
    value.archiveName,
    value.archiveSha256,
    value.archiveSizeBytes,
    value.archiveSourceUrl,
  ];
  const present = fields.filter((field) => field !== undefined).length;
  if (present === 0) return true;
  return (
    present === fields.length &&
    isNonEmptyString(value.archiveName) &&
    isSha256Value(value.archiveSha256) &&
    isPositiveSafeInteger(value.archiveSizeBytes) &&
    isNonEmptyString(value.archiveSourceUrl)
  );
}

function parseMetadata<T>(raw: T): InstalledVersionMetadata | null {
  if (!isObjectLike(raw)) return null;
  // SAFETY: raw is a parsed JSON object; every field is validated before use.
  const value = raw as MetadataRecord;
  if (value.schemaVersion !== 1) return null;
  if (!isNonEmptyString(value.version) || !parseCanonicalVersion(value.version)) return null;
  if (!isNonEmptyString(value.target)) return null;
  if (!isNonEmptyString(value.artifactName)) return null;
  if (!isSha256Value(value.artifactSha256)) {
    return null;
  }
  if (!isNonNegativeFinite(value.sizeBytes)) {
    return null;
  }
  if (!isNonEmptyString(value.sourceUrl)) return null;
  if (!archiveProvenanceIsValid(value)) return null;
  if (!isStringValue(value.verification) || !VERIFICATIONS.has(value.verification)) {
    return null;
  }
  if (!isNonEmptyString(value.installedAt) || Number.isNaN(Date.parse(value.installedAt))) {
    return null;
  }

  const metadata: MutableMetadata = {
    schemaVersion: 1,
    version: value.version,
    target: value.target,
    artifactName: value.artifactName,
    artifactSha256: value.artifactSha256.toLowerCase(),
    sizeBytes: value.sizeBytes,
    sourceUrl: value.sourceUrl,
    // SAFETY: VERIFICATIONS holds exactly the metadata verification union members.
    verification: value.verification as InstalledVersionMetadata["verification"],
    installedAt: value.installedAt,
  };
  if (isStringValue(value.archiveName)) metadata.archiveName = value.archiveName;
  if (isStringValue(value.archiveSha256)) {
    metadata.archiveSha256 = value.archiveSha256.toLowerCase();
  }
  if (isNumberValue(value.archiveSizeBytes)) {
    metadata.archiveSizeBytes = value.archiveSizeBytes;
  }
  if (isStringValue(value.archiveSourceUrl)) {
    metadata.archiveSourceUrl = value.archiveSourceUrl;
  }
  return metadata;
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
  const normalized = parseMetadata({ ...metadata, version: canonical });
  if (!normalized) {
    throw new Error("Installed version metadata failed schema validation");
  }
  const path = versionMetadataPath(layout, canonical);
  await mkdir(dirname(path), { recursive: true });
  await writeAtomicJson(path, normalized);
}

/**
 * Repair the exact archive metadata shape emitted before version.json carried
 * transport provenance. The manifest migration owns both version and
 * activation locks, so this cannot race a replacement publication.
 */
export async function migrateArchiveVersionMetadata(
  layout: Pick<InstallLayoutPaths, "versionsDir" | "binaryFileName">,
  manifest: Pick<
    InstallManifest,
    | "activeVersion"
    | "artifactName"
    | "artifactSha256"
    | "artifactSizeBytes"
    | "artifactSourceUrl"
    | "archiveName"
    | "archiveSha256"
    | "archiveSizeBytes"
    | "archiveSourceUrl"
  >,
): Promise<boolean> {
  if (
    !manifest.artifactName ||
    !manifest.artifactSha256 ||
    manifest.artifactSizeBytes === undefined ||
    !manifest.artifactSourceUrl ||
    !manifest.archiveName ||
    !manifest.archiveSha256 ||
    manifest.archiveSizeBytes === undefined ||
    !manifest.archiveSourceUrl
  ) {
    return false;
  }

  const path = versionMetadataPath(layout, manifest.activeVersion);
  if (!existsSync(path)) return false;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return false;
  }
  const metadata = parseMetadata(raw);
  if (
    !metadata ||
    metadata.version !== manifest.activeVersion ||
    metadata.archiveName !== undefined ||
    metadata.artifactName !== manifest.artifactName ||
    metadata.artifactSha256 !== manifest.artifactSha256.toLowerCase() ||
    metadata.sizeBytes !== manifest.artifactSizeBytes ||
    metadata.sourceUrl !== manifest.archiveSourceUrl
  ) {
    return false;
  }

  await writeInstalledVersionMetadata(layout, {
    ...metadata,
    sourceUrl: manifest.artifactSourceUrl,
    archiveName: manifest.archiveName,
    archiveSha256: manifest.archiveSha256,
    archiveSizeBytes: manifest.archiveSizeBytes,
    archiveSourceUrl: manifest.archiveSourceUrl,
  });
  return true;
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
