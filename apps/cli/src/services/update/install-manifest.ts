import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { withActivationLock } from "./native-installer/activation-lock";
import { getInstallLayoutPaths, type InstallLayoutPaths } from "./native-installer/install-layout";
import { withVersionLock } from "./native-installer/version-lock";
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

/** True when this is a native binary install with a versioned store path. */
export function isVersionedBinaryManifest(manifest: InstallManifest): boolean {
  return manifest.method === "binary" && Boolean(manifest.versionedPath);
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
    raw = JSON.parse(rawText) as unknown;
  } catch {
    return { status: "invalid", reason: "invalid-json" };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "invalid", reason: "invalid-shape" };
  }

  const record = raw as Record<string, unknown>;
  if ("schemaVersion" in record) {
    return inspectCurrentSchema(record, configDir);
  }
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
      if (!current.needsMigration) {
        return { status: "unchanged", manifest: current.manifest } as const;
      }

      await persistManifest(current.manifest, layout.configDir);
      return { status: "migrated", manifest: current.manifest } as const;
    });
  });

  return migrated ?? { status: "lock-contention" };
}

export async function writeInstallManifest(
  partial: WriteInstallManifestInput,
  configDir = getKunaiPaths().configDir,
): Promise<void> {
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
  const activeVersion = parseCanonicalVersion(partial.activeVersion);
  if (!activeVersion) {
    throw new Error(`Invalid install manifest version: ${partial.activeVersion}`);
  }

  const layout = getInstallLayoutPaths({
    configDir,
    launcherPath: partial.launcherPath,
  });
  const managedPaths = partial.managedPaths ?? deriveManagedPaths(partial.method, layout);
  if (!managedPathsAreSafe(managedPaths, layout, partial.method)) {
    throw new Error("Refusing to write install manifest with unsafe managedPaths");
  }

  let previousVersion: string | undefined;
  if (partial.previousVersion !== undefined) {
    previousVersion = parseCanonicalVersion(partial.previousVersion) ?? undefined;
    if (!previousVersion) {
      throw new Error(`Invalid install manifest previousVersion: ${partial.previousVersion}`);
    }
  }

  const existing = await inspectInstallManifest(configDir);
  const now = new Date().toISOString();
  const installedAt = existing.status === "loaded" ? existing.manifest.installedAt : now;

  const full: InstallManifest = {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    method: partial.method,
    activeVersion,
    preferredChannel: "stable",
    launcherPath: partial.launcherPath,
    managedPaths: [...managedPaths],
    downloadBaseUrl: partial.downloadBaseUrl,
    installedAt,
    updatedAt: now,
    ...(partial.versionedPath ? { versionedPath: partial.versionedPath } : {}),
    ...(previousVersion ? { previousVersion } : {}),
    ...(partial.observedProvenance ? { observedProvenance: partial.observedProvenance } : {}),
    ...(partial.target ? { target: partial.target } : {}),
    ...(partial.artifactName ? { artifactName: partial.artifactName } : {}),
    ...(partial.artifactSha256 ? { artifactSha256: partial.artifactSha256 } : {}),
    ...(partial.artifactSizeBytes !== undefined
      ? { artifactSizeBytes: partial.artifactSizeBytes }
      : {}),
    ...(partial.artifactSourceUrl ? { artifactSourceUrl: partial.artifactSourceUrl } : {}),
    ...(partial.archiveName ? { archiveName: partial.archiveName } : {}),
    ...(partial.archiveSha256 ? { archiveSha256: partial.archiveSha256 } : {}),
    ...(partial.archiveSizeBytes !== undefined
      ? { archiveSizeBytes: partial.archiveSizeBytes }
      : {}),
    ...(partial.archiveSourceUrl ? { archiveSourceUrl: partial.archiveSourceUrl } : {}),
  };

  await persistManifest(full, configDir);
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
  record: Record<string, unknown>,
  configDir: string,
): InstallManifestInspection {
  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (schemaVersion !== 1 && schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION) {
    return { status: "invalid", reason: "unsupported-schema" };
  }

  const method = record.method;
  if (typeof method !== "string" || !METHODS.has(method)) {
    return { status: "invalid", reason: "unknown-method" };
  }
  const typedMethod = method as InstallManifestMethod;

  if (typeof record.installedAt !== "string" || !record.installedAt) {
    return { status: "invalid", reason: "missing-timestamp" };
  }
  if (typeof record.updatedAt !== "string" || !record.updatedAt) {
    return { status: "invalid", reason: "missing-timestamp" };
  }
  if (typeof record.launcherPath !== "string" || !record.launcherPath) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (typeof record.downloadBaseUrl !== "string" || !record.downloadBaseUrl) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (record.preferredChannel !== "stable") {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (typeof record.activeVersion !== "string") {
    return { status: "invalid", reason: "invalid-version" };
  }
  if (!parseCanonicalVersion(record.activeVersion)) {
    return { status: "invalid", reason: "invalid-version" };
  }
  if (record.previousVersion !== undefined) {
    if (
      typeof record.previousVersion !== "string" ||
      !parseCanonicalVersion(record.previousVersion)
    ) {
      return { status: "invalid", reason: "invalid-version" };
    }
  }
  if (
    !Array.isArray(record.managedPaths) ||
    !record.managedPaths.every((p) => typeof p === "string")
  ) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!archiveProvenanceComplete(record)) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (!archiveHasArtifactProvenance(record)) {
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

  const manifest: InstallManifest = {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    method: typedMethod,
    activeVersion: record.activeVersion,
    preferredChannel: "stable",
    launcherPath: record.launcherPath,
    managedPaths: record.managedPaths as string[],
    downloadBaseUrl: record.downloadBaseUrl,
    installedAt: record.installedAt,
    updatedAt: record.updatedAt,
    ...(typeof record.versionedPath === "string" ? { versionedPath: record.versionedPath } : {}),
    ...(typeof record.previousVersion === "string"
      ? { previousVersion: record.previousVersion }
      : {}),
    ...(typeof record.observedProvenance === "string"
      ? { observedProvenance: record.observedProvenance }
      : {}),
    ...(typeof record.target === "string" ? { target: record.target } : {}),
    ...(typeof record.artifactName === "string" ? { artifactName: record.artifactName } : {}),
    ...(typeof record.artifactSha256 === "string" ? { artifactSha256: record.artifactSha256 } : {}),
    ...(typeof record.artifactSizeBytes === "number"
      ? { artifactSizeBytes: record.artifactSizeBytes }
      : {}),
    ...(typeof record.artifactSourceUrl === "string"
      ? { artifactSourceUrl: record.artifactSourceUrl }
      : {}),
    ...(typeof record.archiveName === "string" ? { archiveName: record.archiveName } : {}),
    ...(typeof record.archiveSha256 === "string" ? { archiveSha256: record.archiveSha256 } : {}),
    ...(typeof record.archiveSizeBytes === "number"
      ? { archiveSizeBytes: record.archiveSizeBytes }
      : {}),
    ...(typeof record.archiveSourceUrl === "string"
      ? { archiveSourceUrl: record.archiveSourceUrl }
      : {}),
  };

  return { status: "loaded", needsMigration: schemaVersion === 1, manifest };
}

function inspectLegacySchema(
  legacy: LegacyInstallManifest,
  configDir: string,
): InstallManifestInspection {
  if (typeof legacy.channel !== "string" || !METHODS.has(legacy.channel)) {
    return { status: "invalid", reason: "unknown-method" };
  }
  if (typeof legacy.binPath !== "string" || !legacy.binPath) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (typeof legacy.dlBase !== "string" || !legacy.dlBase) {
    return { status: "invalid", reason: "invalid-shape" };
  }
  if (typeof legacy.installedAt !== "string" || !legacy.installedAt) {
    return { status: "invalid", reason: "missing-timestamp" };
  }
  if (typeof legacy.version !== "string") {
    return { status: "invalid", reason: "invalid-version" };
  }
  if (!parseCanonicalVersion(legacy.version)) {
    return { status: "invalid", reason: "invalid-version" };
  }

  const method = legacy.channel as InstallManifestMethod;
  const layout = getInstallLayoutPaths({
    configDir,
    launcherPath: legacy.binPath,
  });
  const now = new Date().toISOString();
  const manifest: InstallManifest = {
    schemaVersion: INSTALL_MANIFEST_SCHEMA_VERSION,
    method,
    activeVersion: legacy.version,
    preferredChannel: "stable",
    launcherPath: legacy.binPath,
    managedPaths: [...deriveManagedPaths(method, layout)],
    downloadBaseUrl: legacy.dlBase,
    installedAt: legacy.installedAt,
    updatedAt: now,
    ...(typeof legacy.versionPath === "string" && legacy.versionPath
      ? { versionedPath: legacy.versionPath }
      : {}),
  };

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
    if (typeof entry !== "string" || !entry || !isAbsolute(entry)) return false;
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

function optionalString(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0);
}

function optionalSha256(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value));
}

function optionalSize(value: unknown): boolean {
  return (
    value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  );
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

function archiveHasArtifactProvenance(value: {
  readonly archiveName?: unknown;
  readonly artifactName?: unknown;
  readonly artifactSha256?: unknown;
  readonly artifactSizeBytes?: unknown;
  readonly artifactSourceUrl?: unknown;
}): boolean {
  if (value.archiveName === undefined) return true;
  return (
    typeof value.artifactName === "string" &&
    value.artifactName.length > 0 &&
    typeof value.artifactSha256 === "string" &&
    /^[a-fA-F0-9]{64}$/.test(value.artifactSha256) &&
    typeof value.artifactSizeBytes === "number" &&
    Number.isSafeInteger(value.artifactSizeBytes) &&
    value.artifactSizeBytes > 0 &&
    typeof value.artifactSourceUrl === "string" &&
    value.artifactSourceUrl.length > 0
  );
}
