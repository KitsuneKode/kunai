#!/usr/bin/env bun
/**
 * Reconcile the nine npm packages in a release candidate with the registry.
 *
 * Platform packages are packed and reconciled in canonical target order. The
 * already-preserved launcher tarball is inspected without repacking and is
 * always reconciled last. Dry run is the default; only `--yes` may publish.
 */
import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  type LocalPackageCandidate,
  type PublicationDecision,
  reconcileCandidate,
} from "./npm-publication-plan";
import { PLATFORM_PACKAGE_NAMES } from "./sync-npm-platform-versions";

const ROOT = join(import.meta.dirname, "..");
const CLI_ROOT = join(ROOT, "apps/cli");
const PLATFORM_DIRECTORY = join(CLI_ROOT, "dist/npm-platform");
const RELEASE_CANDIDATE_DIRECTORY = join(ROOT, ".release-candidate");
const PLATFORM_TARBALL_DIRECTORY = join(RELEASE_CANDIDATE_DIRECTORY, "npm-platform");
const LAUNCHER_TARBALL_PATH = join(RELEASE_CANDIDATE_DIRECTORY, "kunai-npm.tgz");

export interface CommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandPort = (request: CommandRequest) => Promise<CommandResult>;

export interface RegistryPackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface RegistryPort {
  queryIntegrity(candidate: LocalPackageCandidate): Promise<string | null>;
  queryMetadata(candidate: LocalPackageCandidate): Promise<RegistryPackageMetadata | null>;
}

interface NpmPackMetadata {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly filename: string;
}

export interface BuildLocalPackageCandidatesOptions {
  readonly command: CommandPort;
  readonly launcherManifestPath?: string;
  readonly launcherTarballPath?: string;
  readonly platformDirectory?: string;
  readonly platformTarballDirectory?: string;
}

export interface ReconcileNpmPublicationOptions {
  readonly candidates: readonly LocalPackageCandidate[];
  readonly confirmed: boolean;
  readonly command: CommandPort;
  readonly registry: RegistryPort;
  readonly log?: (message: string) => void;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatCommand(request: CommandRequest): string {
  return [request.command, ...request.args].join(" ");
}

function commandError(label: string, request: CommandRequest, result: CommandResult): Error {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  return new Error(
    `[publish] ${label} failed with exit code ${result.exitCode}: ${formatCommand(request)}` +
      (output ? `\n${output}` : ""),
  );
}

function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[publish] could not parse ${context} JSON: ${message}`, { cause: error });
  }
}

function parseNpmPackMetadata(stdout: string, context: string): NpmPackMetadata {
  const parsed = parseJson(stdout, `${context} npm pack`);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isJsonObject(parsed[0])) {
    throw new Error(`[publish] ${context} npm pack must return exactly one metadata record.`);
  }
  const record = parsed[0];
  for (const field of ["name", "version", "integrity", "filename"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new Error(`[publish] ${context} npm pack metadata has no ${field}.`);
    }
  }
  return record as unknown as NpmPackMetadata;
}

function isSha512Integrity(value: string): boolean {
  return /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function assertNonemptyTarball(path: string, context: string): Promise<void> {
  let file;
  try {
    file = await stat(path);
  } catch (error) {
    throw new Error(`[publish] ${context} tarball is missing: ${path}`, { cause: error });
  }
  if (!file.isFile() || file.size === 0) {
    throw new Error(`[publish] ${context} tarball must be a nonempty file: ${path}`);
  }
}

function platformIdFromPackageName(name: string): string {
  return name.slice("@kitsunekode/kunai-".length);
}

/** Build the complete ordered local candidate set before touching the registry. */
export async function buildLocalPackageCandidates(
  options: BuildLocalPackageCandidatesOptions,
): Promise<LocalPackageCandidate[]> {
  const launcherManifestPath = options.launcherManifestPath ?? join(CLI_ROOT, "package.json");
  const launcherTarballPath = options.launcherTarballPath ?? LAUNCHER_TARBALL_PATH;
  const platformDirectory = options.platformDirectory ?? PLATFORM_DIRECTORY;
  const platformTarballDirectory = options.platformTarballDirectory ?? PLATFORM_TARBALL_DIRECTORY;
  const manifest = parseJson(await readFile(launcherManifestPath, "utf8"), launcherManifestPath);
  if (
    !isJsonObject(manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`[publish] invalid launcher manifest: ${launcherManifestPath}`);
  }

  await mkdir(platformTarballDirectory, { recursive: true });
  const candidates: LocalPackageCandidate[] = [];
  for (const name of PLATFORM_PACKAGE_NAMES) {
    const id = platformIdFromPackageName(name);
    const packageDirectory = join(platformDirectory, id);
    const request: CommandRequest = {
      command: "npm",
      args: [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        platformTarballDirectory,
        packageDirectory,
      ],
      cwd: ROOT,
    };
    const result = await options.command(request);
    if (result.exitCode !== 0) throw commandError(`npm pack for ${name}`, request, result);
    const packed = parseNpmPackMetadata(result.stdout, name);
    const tarballPath = join(platformTarballDirectory, packed.filename);
    candidates.push({
      name: packed.name,
      version: packed.version,
      tarballPath,
      integrity: packed.integrity,
      role: "platform",
    });
  }

  await assertNonemptyTarball(launcherTarballPath, "launcher");
  const launcherRequest: CommandRequest = {
    command: "npm",
    args: ["pack", "--json", "--dry-run", "--ignore-scripts", launcherTarballPath],
    cwd: ROOT,
  };
  const launcherResult = await options.command(launcherRequest);
  if (launcherResult.exitCode !== 0) {
    throw commandError("npm pack inspection for launcher", launcherRequest, launcherResult);
  }
  const launcher = parseNpmPackMetadata(launcherResult.stdout, "launcher");
  candidates.push({
    name: launcher.name,
    version: launcher.version,
    tarballPath: launcherTarballPath,
    integrity: launcher.integrity,
    role: "launcher",
  });

  await validateLocalCandidates(candidates, {
    name: manifest.name,
    version: manifest.version,
  });
  return candidates;
}

async function validateLocalCandidates(
  candidates: readonly LocalPackageCandidate[],
  launcherIdentity?: { readonly name: string; readonly version: string },
): Promise<void> {
  const expectedNames = [...PLATFORM_PACKAGE_NAMES, "@kitsunekode/kunai"];
  if (candidates.length !== expectedNames.length) {
    throw new Error(
      `[publish] expected ${expectedNames.length} local npm candidates, found ${candidates.length}.`,
    );
  }

  const names = candidates.map((candidate) => candidate.name);
  if (new Set(names).size !== names.length) {
    throw new Error("[publish] local npm candidates contain duplicate package names.");
  }
  if (names.some((name, index) => name !== expectedNames[index])) {
    throw new Error(
      `[publish] local npm candidates are not in canonical platform-then-launcher order: ${names.join(", ")}`,
    );
  }

  const commonVersion = launcherIdentity?.version ?? candidates.at(-1)?.version;
  if (!commonVersion) throw new Error("[publish] local npm candidates have no version.");
  for (const [index, candidate] of candidates.entries()) {
    const expectedRole = index < PLATFORM_PACKAGE_NAMES.length ? "platform" : "launcher";
    if (candidate.role !== expectedRole) {
      throw new Error(`[publish] ${candidate.name}@${candidate.version} has invalid role.`);
    }
    if (candidate.version !== commonVersion) {
      throw new Error(
        `[publish] ${candidate.name} is ${candidate.version}; expected common version ${commonVersion}.`,
      );
    }
    if (!isSha512Integrity(candidate.integrity)) {
      throw new Error(
        `[publish] ${candidate.name}@${candidate.version} has invalid sha512 integrity.`,
      );
    }
    await assertNonemptyTarball(candidate.tarballPath, `${candidate.name}@${candidate.version}`);
  }

  if (
    launcherIdentity &&
    (launcherIdentity.name !== "@kitsunekode/kunai" ||
      candidates.at(-1)?.name !== launcherIdentity.name)
  ) {
    throw new Error(
      `[publish] launcher identity mismatch: manifest ${launcherIdentity.name}, packed ${candidates.at(-1)?.name}.`,
    );
  }
}

function npmNotFound(result: CommandResult): boolean {
  const combined = `${result.stdout}\n${result.stderr}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    try {
      parsed = JSON.parse(result.stderr) as unknown;
    } catch {
      parsed = undefined;
    }
  }
  const error = isJsonObject(parsed) && isJsonObject(parsed.error) ? parsed.error : undefined;
  const jsonE404 = error?.code === "E404";
  const textE404 = /npm (?:error|ERR!) code E404/i.test(combined);
  const notFound = /(?:404\s+Not Found|not found|no match found)/i.test(combined);
  return (jsonE404 || textE404) && notFound;
}

function parseRegistryIntegrity(stdout: string, context: string): string {
  const parsed = parseJson(stdout, context);
  if (typeof parsed !== "string" || !isSha512Integrity(parsed)) {
    throw new Error(`[publish] ${context} JSON did not contain a sha512 integrity string.`);
  }
  return parsed;
}

function parseRegistryMetadata(stdout: string, context: string): RegistryPackageMetadata {
  const parsed = parseJson(stdout, context);
  if (!isJsonObject(parsed)) {
    throw new Error(`[publish] ${context} JSON did not contain package metadata.`);
  }
  const integrity =
    typeof parsed["dist.integrity"] === "string"
      ? parsed["dist.integrity"]
      : isJsonObject(parsed.dist) && typeof parsed.dist.integrity === "string"
        ? parsed.dist.integrity
        : undefined;
  if (
    typeof parsed.name !== "string" ||
    typeof parsed.version !== "string" ||
    typeof integrity !== "string" ||
    !isSha512Integrity(integrity)
  ) {
    throw new Error(
      `[publish] ${context} JSON did not contain name, version, and sha512 integrity.`,
    );
  }
  return { name: parsed.name, version: parsed.version, integrity };
}

/** npm-backed registry adapter. Only a documented E404/not-found is absence. */
export function createNpmRegistryPort(command: CommandPort): RegistryPort {
  async function query(
    candidate: LocalPackageCandidate,
    fields: readonly string[],
  ): Promise<CommandResult | null> {
    const request: CommandRequest = {
      command: "npm",
      args: ["view", `${candidate.name}@${candidate.version}`, ...fields, "--json"],
      cwd: ROOT,
    };
    const result = await command(request);
    if (result.exitCode === 0) return result;
    if (npmNotFound(result)) return null;
    throw commandError("npm view", request, result);
  }

  return {
    async queryIntegrity(candidate) {
      const result = await query(candidate, ["dist.integrity"]);
      return result
        ? parseRegistryIntegrity(result.stdout, `npm view ${candidate.name}@${candidate.version}`)
        : null;
    },
    async queryMetadata(candidate) {
      const result = await query(candidate, ["name", "version", "dist.integrity"]);
      return result
        ? parseRegistryMetadata(result.stdout, `npm view ${candidate.name}@${candidate.version}`)
        : null;
    },
  };
}

function assertVerified(
  candidate: LocalPackageCandidate,
  registry: RegistryPackageMetadata | null,
): void {
  if (
    registry?.name !== candidate.name ||
    registry.version !== candidate.version ||
    registry.integrity !== candidate.integrity
  ) {
    throw new Error(
      `[publish] verification failed for ${candidate.name}@${candidate.version}; name/version/integrity expected ` +
        `${candidate.integrity}, received ${registry ? `${registry.name}@${registry.version} ${registry.integrity}` : "not found"}.`,
    );
  }
}

/** Reconcile validated candidates sequentially, preserving launcher-last safety. */
export async function reconcileNpmPublication(
  options: ReconcileNpmPublicationOptions,
): Promise<PublicationDecision[]> {
  await validateLocalCandidates(options.candidates);
  const decisions: PublicationDecision[] = [];
  for (const candidate of options.candidates) {
    const registryIntegrity = await options.registry.queryIntegrity(candidate);
    const decision = reconcileCandidate(candidate, registryIntegrity);
    decisions.push(decision);
    options.log?.(
      `[publish] ${decision.action} ${candidate.name}@${candidate.version} (${candidate.integrity})`,
    );

    if (!options.confirmed) {
      if (decision.action === "skip") {
        assertVerified(candidate, await options.registry.queryMetadata(candidate));
      }
      continue;
    }
    if (decision.action === "publish") {
      const request: CommandRequest = {
        command: "npm",
        args: ["publish", candidate.tarballPath, "--access", "public", "--provenance"],
        cwd: ROOT,
      };
      const result = await options.command(request);
      if (result.exitCode !== 0) throw commandError("npm publish", request, result);
    }
    assertVerified(candidate, await options.registry.queryMetadata(candidate));
  }
  return decisions;
}

export function parsePublishArgs(args: readonly string[]): { readonly confirmed: boolean } {
  if (args.length === 0 || (args.length === 1 && args[0] === "--dry-run")) {
    return { confirmed: false };
  }
  if (args.length === 1 && args[0] === "--yes") return { confirmed: true };
  if (args.includes("--yes") && args.includes("--dry-run")) {
    throw new Error("[publish] --yes and --dry-run cannot be used together.");
  }
  throw new Error(`[publish] unknown arguments: ${args.join(" ")}`);
}

export const defaultCommandPort: CommandPort = async (request) => {
  const process = Bun.spawn([request.command, ...request.args], {
    cwd: request.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

async function main(): Promise<void> {
  const { confirmed } = parsePublishArgs(process.argv.slice(2));
  const candidates = await buildLocalPackageCandidates({ command: defaultCommandPort });
  const registry = createNpmRegistryPort(defaultCommandPort);
  await reconcileNpmPublication({
    candidates,
    confirmed,
    command: defaultCommandPort,
    registry,
    log: console.log,
  });
  console.log(
    confirmed
      ? `[publish] reconciled ${candidates.length} packages at ${candidates[0]?.version}.`
      : `[publish] dry run complete for ${candidates.length} packages; no packages were published.`,
  );
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
