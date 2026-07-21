import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import { getInstallLayoutPaths, type InstallLayoutPaths } from "./native-installer/install-layout";
import { parseCanonicalVersion } from "./version";

/**
 * Records how this Kunai install happened so `kunai upgrade` / `kunai uninstall`
 * route to the correct mechanism and never fight another installer.
 * Authoritative when present; otherwise callers fall back to `detectInstallMethod`.
 */
export const INSTALL_MANIFEST_SCHEMA_VERSION = 1 as const;

export type InstallManifestMethod = "binary" | "npm-global" | "bun-global" | "source";

export interface InstallManifest {
  readonly schemaVersion: 1;
  readonly method: InstallManifestMethod;
  readonly observedProvenance?: string;
  readonly activeVersion: string;
  readonly previousVersion?: string;
  readonly preferredChannel: "stable";
  readonly launcherPath: string;
  readonly versionedPath?: string;
  readonly managedPaths: readonly string[];
  readonly target?: string;
  readonly artifactSha256?: string;
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

export type WriteInstallManifestInput = {
  readonly method: InstallManifestMethod;
  readonly activeVersion: string;
  readonly launcherPath: string;
  readonly downloadBaseUrl: string;
  readonly versionedPath?: string;
  readonly previousVersion?: string;
  readonly observedProvenance?: string;
  readonly target?: string;
  readonly artifactSha256?: string;
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

/**
 * Read the install ownership record. Atomically migrates valid legacy schema.
 * Never writes for invalid / unsupported / missing manifests.
 */
export async function readInstallManifest(
  configDir = getKunaiPaths().configDir,
): Promise<InstallManifest | null> {
  const inspection = await inspectInstallManifest(configDir);
  if (inspection.status !== "loaded") return null;
  if (inspection.needsMigration) {
    await persistManifest(inspection.manifest, configDir);
  }
  return inspection.manifest;
}

export async function writeInstallManifest(
  partial: WriteInstallManifestInput,
  configDir = getKunaiPaths().configDir,
): Promise<void> {
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
    ...(partial.previousVersion ? { previousVersion: partial.previousVersion } : {}),
    ...(partial.observedProvenance ? { observedProvenance: partial.observedProvenance } : {}),
    ...(partial.target ? { target: partial.target } : {}),
    ...(partial.artifactSha256 ? { artifactSha256: partial.artifactSha256 } : {}),
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
  if (schemaVersion !== INSTALL_MANIFEST_SCHEMA_VERSION) {
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
  if (
    !Array.isArray(record.managedPaths) ||
    !record.managedPaths.every((p) => typeof p === "string")
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
    schemaVersion: 1,
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
    ...(typeof record.artifactSha256 === "string" ? { artifactSha256: record.artifactSha256 } : {}),
  };

  return { status: "loaded", needsMigration: false, manifest };
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
