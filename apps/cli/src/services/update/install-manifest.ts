import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { withActivationLock, type ActivationLockOptions } from "./native-installer/activation-lock";
import { getInstallLayoutPaths, type InstallLayoutPaths } from "./native-installer/install-layout";
import { withVersionLock } from "./native-installer/version-lock";
import { migrateArchiveVersionMetadata } from "./native-installer/version-metadata";
import { parseCanonicalVersion } from "./version";

/**
 * Records how this Kunai install happened so `kunai upgrade` / `kunai uninstall`
 * route to the correct mechanism and never fight another installer.
 * Authoritative when present; otherwise callers fall back to `detectInstallMethod`.
 */
export const INSTALL_MANIFEST_SCHEMA_VERSION = 2 as const;

export type InstallManifestMethod = "binary" | "npm-global" | "bun-global" | "source";

export interface InstallManifest {
  readonly schemaVersion: 2;
  readonly method: InstallManifestMethod;
  readonly observedProvenance?: string;
  readonly activeVersion: string;
  readonly previousVersion?: string;
  readonly preferredChannel: "stable";
  readonly launcherPath: string;
  readonly versionedPath?: string;
  readonly managedPaths: readonly string[];
  readonly target?: string;
  readonly artifactName?: string;
  readonly artifactSha256?: string;
  readonly artifactSizeBytes?: number;
  readonly artifactSourceUrl?: string;
  readonly archiveName?: string;
  readonly archiveSha256?: string;
  readonly archiveSizeBytes?: number;
  readonly archiveSourceUrl?: string;
  readonly downloadBaseUrl: string;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export type InstallManifestInvalidReason =
  | "invalid-json"
  | "invalid-shape"
  | "missing-timestamp"
  | "invalid-version"
  | "unsupported-schema"
  | "malicious-managed-paths"
  | "unknown-method";

export type InstallManifestInspection =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: InstallManifestInvalidReason }
  | {
      readonly status: "loaded";
      readonly needsMigration: boolean;
      readonly manifest: InstallManifest;
    };

export type InstallManifestMigrationResult =
  | { readonly status: "migrated" | "unchanged"; readonly manifest: InstallManifest }
  | { readonly status: "deferred"; readonly manifest: InstallManifest }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: InstallManifestInvalidReason }
  | { readonly status: "lock-contention" };

export type WriteInstallManifestInput = {
  readonly method: InstallManifestMethod;
  readonly activeVersion: string;
  readonly launcherPath: string;
  readonly downloadBaseUrl: string;
  readonly versionedPath?: string;
  readonly previousVersion?: string;
  readonly observedProvenance?: string;
  readonly target?: string;
  readonly artifactName?: string;
  readonly artifactSha256?: string;
  readonly artifactSizeBytes?: number;
  readonly artifactSourceUrl?: string;
  readonly archiveName?: string;
  readonly archiveSha256?: string;
  readonly archiveSizeBytes?: number;
  readonly archiveSourceUrl?: string;
  readonly managedPaths?: readonly string[];
};

const FILENAME = "install.json";
const METHODS = new Set<string>(["binary", "npm-global", "bun-global", "source"]);

type LegacyInstallManifest = {
  readonly channel?: unknown;
  readonly version?: unknown;
  readonly binPath?: unknown;
  readonly versionPath?: unknown;
  readonly dlBase?: unknown;
  readonly installedAt?: unknown;
  readonly layout?: unknown;
  readonly schemaVersion?: unknown;
};

type MutableInstallManifest = {
  -readonly [K in keyof InstallManifest]: InstallManifest[K];
};

type StoredManifestRecord = {
  readonly schemaVersion?: unknown;
  readonly method?: unknown;
  readonly installedAt?: unknown;
  readonly updatedAt?: unknown;
  readonly launcherPath?: unknown;
  readonly downloadBaseUrl?: unknown;
  readonly preferredChannel?: unknown;
  readonly activeVersion?: unknown;
  readonly previousVersion?: unknown;
  readonly managedPaths?: unknown;
  readonly versionedPath?: unknown;
  readonly observedProvenance?: unknown;
  readonly target?: unknown;
  readonly artifactName?: unknown;
  readonly artifactSha256?: unknown;
  readonly artifactSizeBytes?: unknown;
  readonly artifactSourceUrl?: unknown;
  readonly archiveName?: unknown;
  readonly archiveSha256?: unknown;
  readonly archiveSizeBytes?: unknown;
  readonly archiveSourceUrl?: unknown;
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

function isIntegerValue<T>(value: T): value is T & number {
  return Number.isInteger(value);
}

function isPositiveSafeInteger<T>(value: T): value is T & number {
  // SAFETY: Number.isSafeInteger has already rejected every non-number value.
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSha256Value<T>(value: T): value is T & string {
  return isStringValue(value) && /^[a-fA-F0-9]{64}$/.test(value);
}

function isNumberValue<T>(value: T): value is T & number {
  return Object.prototype.toString.call(value) === "[object Number]";
}

/** True when this is a native binary install with a versioned store path. */
export function isVersionedBinaryManifest(manifest: InstallManifest): boolean {
  return manifest.method === "binary" && Boolean(manifest.versionedPath);
}

/** Identity used by removers to avoid deleting a replacement publication. */
export function sameInstallManifestPublication(
  left: InstallManifest,
  right: InstallManifest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameInstallManifestMigrationSource(
  left: InstallManifest,
  right: InstallManifest,
): boolean {
  // Legacy manifests have no updatedAt, so each read synthesizes a fresh one.
  // Ignore only that derived field while still detecting a replacement of any
  // ownership, path, version, or provenance field during migration planning.
  return sameInstallManifestPublication(
    { ...left, updatedAt: "migration-source" },
    { ...right, updatedAt: "migration-source" },
  );
}

/** Derive ownership roots Kunai may manage for a native binary install. */
export function deriveManagedPaths(
  method: InstallManifestMethod,
  layout: Pick<InstallLayoutPaths, "dataDir" | "cacheDir"> = getInstallLayoutPaths(),
): readonly string[] {
  if (method !== "binary") return [];
  return [layout.dataDir, layout.cacheDir];
}

export async function inspectInstallManifest(
  configDir = getKunaiPaths().configDir,
): Promise<InstallManifestInspection> {
  const path = joinManifestPath(configDir);
  if (!existsSync(path)) return { status: "missing" };

  let rawText: string;
  try {
    rawText = await readFile(path, "utf8");
  } catch {
    return { status: "invalid", reason: "invalid-json" };
  }

  let raw: unknown;
  try {
    // SAFETY: JSON.parse returns any; the fields are decoded field-by-field below.
    raw = JSON.parse(rawText) as unknown;
  } catch {
    return { status: "invalid", reason: "invalid-json" };
  }

  if (!isObjectLike(raw)) {
    return { status: "invalid", reason: "invalid-shape" };
  }

  // SAFETY: raw is a parsed JSON object; every field is validated before use.
  const record = raw as StoredManifestRecord;
  if ("schemaVersion" in record) {
    return inspectCurrentSchema(record, configDir);
  }
  // SAFETY: raw is a parsed JSON object; every field is validated before use.
  return inspectLegacySchema(record as LegacyInstallManifest, configDir);
}

/** Read the install ownership record without mutating it. */
export async function readInstallManifest(
  configDir = getKunaiPaths().configDir,
): Promise<InstallManifest | null> {
  const inspection = await inspectInstallManifest(configDir);
  if (inspection.status !== "loaded") return null;
  return inspection.manifest;
}

/**
 * Publish a schema migration only while lifecycle, version, and activation
 * ownership exclude uninstall and competing native activation. The manifest is
 * re-read inside the locks so a replacement is preserved and a removal is not
 * recreated from a stale snapshot.
 */
export async function migrateInstallManifest(
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
): Promise<InstallManifestMigrationResult> {
  const observed = await inspectInstallManifest(layout.configDir);
  if (observed.status === "missing") return { status: "missing" };
  if (observed.status === "invalid") return observed;
  if (!observed.needsMigration) {
    return { status: "unchanged", manifest: observed.manifest };
  }
  if (observed.manifest.method !== "binary") {
    return { status: "deferred", manifest: observed.manifest };
  }

  const migrated = await withVersionLock(layout, observed.manifest.activeVersion, async () => {
    return withActivationLock(layout, observed.manifest.activeVersion, async () => {
      const current = await inspectInstallManifest(layout.configDir);
      if (current.status === "missing") return { status: "missing" } as const;
      if (current.status === "invalid") return current;
      if (!sameInstallManifestMigrationSource(current.manifest, observed.manifest)) {
        if (!current.needsMigration) {
          return { status: "unchanged", manifest: current.manifest } as const;
        }
        return { status: "deferred", manifest: current.manifest } as const;
      }
      if (!current.needsMigration) {
        return { status: "unchanged", manifest: current.manifest } as const;
      }

      if (
        current.manifest.archiveName &&
        !(await migrateArchiveVersionMetadata(layout, current.manifest))
      ) {
        throw new Error(
          `Archive version metadata unavailable for install manifest migration (${current.manifest.activeVersion})`,
        );
      }
      await persistManifest(current.manifest, layout.configDir);
      return { status: "migrated", manifest: current.manifest } as const;
    });
  });

  return migrated ?? { status: "lock-contention" };
}

export async function writeInstallManifest(
  partial: WriteInstallManifestInput,
  layout: InstallLayoutPaths = getInstallLayoutPaths({ launcherPath: partial.launcherPath }),
  activationOptions: ActivationLockOptions = {},
): Promise<void> {
  validateWriteProvenance(partial);
  const activeVersion = parseCanonicalVersion(partial.activeVersion);
  if (!activeVersion) {
    throw new Error(`Invalid install manifest version: ${partial.activeVersion}`);
  }
  if (partial.previousVersion !== undefined && !parseCanonicalVersion(partial.previousVersion)) {
    throw new Error(`Invalid install manifest previousVersion: ${partial.previousVersion}`);
  }
  const published = await withActivationLock(
    layout,
    activeVersion,
    () => writeInstallManifestUnderActivation(partial, layout),
    activationOptions,
  );
  if (published === null) {
    throw new Error(`Install manifest publication lock held while publishing ${activeVersion}`);
  }
}

/** Hold the shared launcher/manifest publication boundary across a compound operation. */
export async function withInstallManifestPublication<T>(
  version: string,
  fn: () => Promise<T>,
  layout: InstallLayoutPaths = getInstallLayoutPaths(),
): Promise<T | null> {
  return withActivationLock(layout, version, fn);
}

/**
 * Publish while the caller already owns the activation lock.
 *
 * Native lifecycle paths use this primitive after acquiring locks in the only
 * supported order: lifecycle/version -> activation -> manifest I/O. Package
 * publishers use `writeInstallManifest`, which acquires activation directly.
 */
export async function writeInstallManifestUnderActivation(
  partial: WriteInstallManifestInput,
  layout: InstallLayoutPaths = getInstallLayoutPaths({ launcherPath: partial.launcherPath }),
): Promise<void> {
  validateWriteProvenance(partial);
  const activeVersion = parseCanonicalVersion(partial.activeVersion);
  if (!activeVersion) {
    throw new Error(`Invalid install manifest version: ${partial.activeVersion}`);
  }

  // Ownership validation remains based on the persisted config/launcher pair;
  // the supplied full layout selects the publication lock root. In production
  // those roots agree, while isolated tests can use a writable lock root
  // without teaching a config-only reader an unverifiable dataDir override.
  const ownershipLayout = getInstallLayoutPaths({
    configDir: layout.configDir,
    launcherPath: partial.launcherPath,
  });
  const managedPaths = partial.managedPaths ?? deriveManagedPaths(partial.method, ownershipLayout);
  if (!managedPathsAreSafe(managedPaths, ownershipLayout, partial.method)) {
    throw new Error("Refusing to write install manifest with unsafe managedPaths");
  }

  let previousVersion: string | undefined;
  if (partial.previousVersion !== undefined) {
    previousVersion = parseCanonicalVersion(partial.previousVersion) ?? undefined;
    if (!previousVersion) {
      throw new Error(`Invalid install manifest previousVersion: ${partial.previousVersion}`);
    }
  }

  const existing = await inspectInstallManifest(layout.configDir);
  const now = new Date().toISOString();
  const installedAt = existing.status === "loaded" ? existing.manifest.installedAt : now;

  const full: MutableInstallManifest = {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    method: partial.method,
    activeVersion,
    preferredChannel: "stable",
    launcherPath: partial.launcherPath,
    managedPaths: [...managedPaths],
    downloadBaseUrl: partial.downloadBaseUrl,
    installedAt,
    updatedAt: now,
  };
  if (partial.versionedPath) full.versionedPath = partial.versionedPath;
  if (previousVersion) full.previousVersion = previousVersion;
  if (partial.observedProvenance) full.observedProvenance = partial.observedProvenance;
  if (partial.target) full.target = partial.target;
  if (partial.artifactName) full.artifactName = partial.artifactName;
  if (partial.artifactSha256) full.artifactSha256 = partial.artifactSha256;
  if (partial.artifactSizeBytes !== undefined) full.artifactSizeBytes = partial.artifactSizeBytes;
  if (partial.artifactSourceUrl) full.artifactSourceUrl = partial.artifactSourceUrl;
  if (partial.archiveName) full.archiveName = partial.archiveName;
  if (partial.archiveSha256) full.archiveSha256 = partial.archiveSha256;
  if (partial.archiveSizeBytes !== undefined) full.archiveSizeBytes = partial.archiveSizeBytes;
  if (partial.archiveSourceUrl) full.archiveSourceUrl = partial.archiveSourceUrl;

  await persistManifest(full, layout.configDir);
}

function validateWriteProvenance(partial: WriteInstallManifestInput): void {
  if (!archiveProvenanceComplete(partial)) {
    throw new Error("Archive provenance must include name, checksum, size, and source URL");
  }
  if (!archiveHasArtifactProvenance(partial)) {
    throw new Error("Archive installs must include extracted binary provenance");
  }
  if (
    !optionalString(partial.artifactName) ||
    !optionalSha256(partial.artifactSha256) ||
    !optionalSize(partial.artifactSizeBytes) ||
    !optionalString(partial.artifactSourceUrl) ||
    !optionalString(partial.archiveName) ||
    !optionalSha256(partial.archiveSha256) ||
    !optionalSize(partial.archiveSizeBytes) ||
    !optionalString(partial.archiveSourceUrl)
  ) {
    throw new Error("Invalid install manifest artifact provenance");
  }
}

/** Startup-only wrapper: expected contention is quiet; corrupt state and I/O fail nonfatally. */
export async function migrateInstallManifestAtStartup(
  options: {
    readonly migrate?: () => Promise<InstallManifestMigrationResult>;
    readonly warn?: (message: string) => void;
  } = {},
): Promise<void> {
  const migrate = options.migrate ?? (() => migrateInstallManifest());
  const warn = options.warn ?? ((message: string) => console.warn(message));
  try {
    const result = await migrate();
    if (result.status === "invalid") {
      warn(`Kunai install manifest migration skipped invalid install.json (${result.reason}).`);
    }
  } catch (error) {
    warn(
      `Kunai install manifest migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function joinManifestPath(configDir: string): string {
  return join(configDir, FILENAME);
}

async function persistManifest(manifest: InstallManifest, configDir: string): Promise<void> {
  const path = joinManifestPath(configDir);
  await mkdir(configDir, { recursive: true });
  // Atomic: temp file in the target dir + rename (CLAUDE.md fs guidance).
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(tmp, path);
}

function inspectCurrentSchema(
  record: StoredManifestRecord,
  configDir: string,
): InstallManifestInspection {
  const schemaVersion = record.schemaVersion;
  if (!isIntegerValue(schemaVersion)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (schemaVersion !== 1 && schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION) {
    return { status: "invalid", reason: "unsupported-schema" };
  }

  const method = record.method;
  if (!isStringValue(method) || !METHODS.has(method)) {
    return { status: "invalid", reason: "unknown-method" };
  }
  // SAFETY: METHODS holds exactly the InstallManifestMethod union members.
  const typedMethod = method as InstallManifestMethod;

  if (!isNonEmptyString(record.installedAt)) {
    return { status: "invalid", reason: "missing-timestamp" };
  }
  if (!isNonEmptyString(record.updatedAt)) {
    return { status: "invalid", reason: "missing-timestamp" };
  }
  if (!isNonEmptyString(record.launcherPath)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!isNonEmptyString(record.downloadBaseUrl)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (record.preferredChannel !== "stable") {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!isStringValue(record.activeVersion)) {
    return { status: "invalid", reason: "invalid-version" };
  }
  if (!parseCanonicalVersion(record.activeVersion)) {
    return { status: "invalid", reason: "invalid-version" };
  }
  if (record.previousVersion !== undefined) {
    if (!isStringValue(record.previousVersion) || !parseCanonicalVersion(record.previousVersion)) {
      return { status: "invalid", reason: "invalid-version" };
    }
  }
  if (!Array.isArray(record.managedPaths) || !record.managedPaths.every(isStringValue)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!archiveProvenanceComplete(record)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  const predecessorArtifactSourceUrl =
    schemaVersion === INSTALL_MANIFEST_SCHEMA_VERSION &&
    record.archiveName !== undefined &&
    record.artifactSourceUrl === undefined &&
    isStringValue(record.artifactName)
      ? `${record.downloadBaseUrl.replace(/\/+$/, "")}/download/v${record.activeVersion}/${record.artifactName}`
      : undefined;
  if (!archiveHasArtifactProvenance(record, predecessorArtifactSourceUrl !== undefined)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!optionalString(record.artifactName) || !optionalSha256(record.artifactSha256)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!optionalSize(record.artifactSizeBytes)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!optionalString(record.artifactSourceUrl)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (
    !optionalString(record.archiveName) ||
    !optionalSha256(record.archiveSha256) ||
    !optionalSize(record.archiveSizeBytes) ||
    !optionalString(record.archiveSourceUrl)
  ) {
    return { status: "invalid", reason: "invalid-shape" };
  }

  const layout = getInstallLayoutPaths({
    configDir,
    launcherPath: record.launcherPath,
  });
  if (!managedPathsAreSafe(record.managedPaths, layout, typedMethod)) {
    return { status: "invalid", reason: "malicious-managed-paths" };
  }

  const manifest: MutableInstallManifest = {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    method: typedMethod,
    activeVersion: record.activeVersion,
    preferredChannel: "stable",
    launcherPath: record.launcherPath,
    // SAFETY: every element passed the isStringValue check above.
    managedPaths: record.managedPaths as string[],
    downloadBaseUrl: record.downloadBaseUrl,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
  };
  if (isStringValue(record.versionedPath)) manifest.versionedPath = record.versionedPath;
  if (isStringValue(record.previousVersion)) manifest.previousVersion = record.previousVersion;
  if (isStringValue(record.observedProvenance)) {
    manifest.observedProvenance = record.observedProvenance;
  }
  if (isStringValue(record.target)) manifest.target = record.target;
  if (isStringValue(record.artifactName)) manifest.artifactName = record.artifactName;
  if (isStringValue(record.artifactSha256)) manifest.artifactSha256 = record.artifactSha256;
  if (isNumberValue(record.artifactSizeBytes)) {
    manifest.artifactSizeBytes = record.artifactSizeBytes;
  }
  const artifactSourceUrl = isStringValue(record.artifactSourceUrl)
    ? record.artifactSourceUrl
    : predecessorArtifactSourceUrl;
  if (artifactSourceUrl !== undefined) manifest.artifactSourceUrl = artifactSourceUrl;
  if (isStringValue(record.archiveName)) manifest.archiveName = record.archiveName;
  if (isStringValue(record.archiveSha256)) manifest.archiveSha256 = record.archiveSha256;
  if (isNumberValue(record.archiveSizeBytes)) {
    manifest.archiveSizeBytes = record.archiveSizeBytes;
  }
  if (isStringValue(record.archiveSourceUrl)) {
    manifest.archiveSourceUrl = record.archiveSourceUrl;
  }

  return {
    status: "loaded",
    needsMigration: schemaVersion === 1 || predecessorArtifactSourceUrl !== undefined,
    manifest,
  };
}

function inspectLegacySchema(
  legacy: LegacyInstallManifest,
  configDir: string,
): InstallManifestInspection {
  if (!isStringValue(legacy.channel) || !METHODS.has(legacy.channel)) {
    return { status: "invalid", reason: "unknown-method" };
  }
  if (!isNonEmptyString(legacy.binPath)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!isNonEmptyString(legacy.dlBase)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!isNonEmptyString(legacy.installedAt)) {
    return { status: "invalid", reason: "missing-timestamp" };
  }
  if (!isStringValue(legacy.version)) {
    return { status: "invalid", reason: "invalid-version" };
  }
  if (!parseCanonicalVersion(legacy.version)) {
    return { status: "invalid", reason: "invalid-version" };
  }

  // SAFETY: METHODS holds exactly the InstallManifestMethod union members.
  const method = legacy.channel as InstallManifestMethod;
  const layout = getInstallLayoutPaths({
    configDir,
    launcherPath: legacy.binPath,
  });
  const now = new Date().toISOString();
  const manifest: MutableInstallManifest = {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    method,
    activeVersion: legacy.version,
    preferredChannel: "stable",
    launcherPath: legacy.binPath,
    managedPaths: [...deriveManagedPaths(method, layout)],
    downloadBaseUrl: legacy.dlBase,
    installedAt: legacy.installedAt,
    updatedAt: now,
  };
  if (isNonEmptyString(legacy.versionPath)) manifest.versionedPath = legacy.versionPath;

  return { status: "loaded", needsMigration: true, manifest };
}

function managedPathsAreSafe(
  paths: readonly string[],
  layout: Pick<InstallLayoutPaths, "dataDir" | "cacheDir">,
  method: InstallManifestMethod,
): boolean {
  if (method !== "binary") {
    return paths.length === 0;
  }
  const allowedRoots = deriveManagedPaths("binary", layout).map((root) => resolve(root));
  for (const entry of paths) {
    if (!entry || !isAbsolute(entry)) return false;
    const normalized = normalize(entry);
    if (normalized.includes("..")) return false;
    const resolved = resolve(normalized);
    const ok = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(`${root}${sep}`),
    );
    if (!ok) return false;
  }
  return true;
}

function optionalString<T>(value: T): boolean {
  return value === undefined || isNonEmptyString(value);
}

function optionalSha256<T>(value: T): boolean {
  return value === undefined || isSha256Value(value);
}

function optionalSize<T>(value: T): boolean {
  return value === undefined || isPositiveSafeInteger(value);
}

function archiveProvenanceComplete(value: {
  readonly archiveName?: unknown;
  readonly archiveSha256?: unknown;
  readonly archiveSizeBytes?: unknown;
  readonly archiveSourceUrl?: unknown;
}): boolean {
  const fields = [
    value.archiveName,
    value.archiveSha256,
    value.archiveSizeBytes,
    value.archiveSourceUrl,
  ];
  const present = fields.filter((field) => field !== undefined).length;
  return present === 0 || present === fields.length;
}

function archiveHasArtifactProvenance(
  value: {
    readonly archiveName?: unknown;
    readonly artifactName?: unknown;
    readonly artifactSha256?: unknown;
    readonly artifactSizeBytes?: unknown;
    readonly artifactSourceUrl?: unknown;
  },
  allowMissingSourceUrl = false,
): boolean {
  if (value.archiveName === undefined) return true;
  return (
    isNonEmptyString(value.artifactName) &&
    isSha256Value(value.artifactSha256) &&
    isPositiveSafeInteger(value.artifactSizeBytes) &&
    (allowMissingSourceUrl || isNonEmptyString(value.artifactSourceUrl))
  );
}
