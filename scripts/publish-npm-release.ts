#!/usr/bin/env bun
/**
 * Reconcile the nine npm packages in a release candidate with the registry.
 *
 * Candidate preparation packs platform packages once. Publication inspects
 * those preserved tarballs without repacking and reconciles them in canonical
 * target order, with the already-preserved launcher always last. Dry run is
 * the default; only `--yes` may publish.
 */
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
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
  readonly platformTarballMode?: "pack" | "inspect";
}

export interface ReconcileNpmPublicationOptions {
  readonly candidates: readonly LocalPackageCandidate[];
  readonly confirmed: boolean;
  readonly command: CommandPort;
  readonly registry: RegistryPort;
  readonly log?: (message: string) => void;
  /**
   * Injected so a test can exhaust the propagation window without sleeping.
   * Defaults to a real timer only on the publication path.
   */
  readonly wait?: (ms: number) => Promise<void>;
}

/**
 * npm applies a publish asynchronously: `npm publish` returns 0 once the write
 * is accepted, and `npm view` can answer "not found" until the registry has
 * applied it. Measured during 0.3.0, not guessed: `kunai-linux-x64-musl` was
 * visible after one 3s retry, while `kunai-linux-arm64` — accepted at 08:01:27Z
 * — carries a registry `time` of 08:08:41Z, seven minutes later, with the exact
 * expected integrity. Provenance shows the same run attempt wrote both. A 27s
 * budget failed the release on a version npm already held.
 *
 * Backs off from 3s to a 30s ceiling, about ten minutes in total. The window
 * is shared by every package written in the same phase, so the release pays
 * the worst lag once, not once per package. Only absence is waited on: an
 * integrity *mismatch* is a wrong artifact and fails on the first read.
 */
const PUBLISH_VISIBILITY_ATTEMPTS = 26;
const PUBLISH_VISIBILITY_MAX_DELAY_MS = 30_000;

function publishVisibilityDelayMs(attempt: number): number {
  return Math.min(PUBLISH_VISIBILITY_MAX_DELAY_MS, 3_000 * attempt);
}

/**
 * A write is reissued only after that entire window still shows nothing — a
 * genuinely dropped write, as distinct from a slow one. No 0.3.0 write was
 * actually dropped; this is insurance, and it is safe because npm refuses to
 * overwrite an existing version, so a reissue that races the first write is
 * rejected and that rejection is itself the confirmation.
 */
const PUBLISH_WRITE_ATTEMPTS = 2;

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

/** Read one required non-empty string field, or fail with the field named. */
function requireStringField(
  record: Readonly<Record<string, unknown>>,
  field: string,
  context: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[publish] ${context} npm pack metadata has no ${field}.`);
  }
  return value;
}

function parseNpmPackMetadata(stdout: string, context: string): NpmPackMetadata {
  const parsed = parseJson(stdout, `${context} npm pack`);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isJsonObject(parsed[0])) {
    throw new Error(`[publish] ${context} npm pack must return exactly one metadata record.`);
  }
  const record = parsed[0];
  // Built field by field rather than asserted: the reads are what prove the
  // shape, so the return type is earned instead of claimed.
  return {
    name: requireStringField(record, "name", context),
    version: requireStringField(record, "version", context),
    integrity: requireStringField(record, "integrity", context),
    filename: requireStringField(record, "filename", context),
  };
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

async function inspectTarball(
  command: CommandPort,
  tarballPath: string,
  context: string,
): Promise<NpmPackMetadata> {
  await assertNonemptyTarball(tarballPath, context);
  const request: CommandRequest = {
    command: "npm",
    args: ["pack", "--json", "--dry-run", "--ignore-scripts", tarballPath],
    cwd: ROOT,
  };
  const result = await command(request);
  if (result.exitCode !== 0) {
    throw commandError(`npm pack inspection for ${context}`, request, result);
  }
  return parseNpmPackMetadata(result.stdout, context);
}

/** Build the complete ordered local candidate set before touching the registry. */
export async function buildLocalPackageCandidates(
  options: BuildLocalPackageCandidatesOptions,
): Promise<LocalPackageCandidate[]> {
  const launcherManifestPath = options.launcherManifestPath ?? join(CLI_ROOT, "package.json");
  const launcherTarballPath = options.launcherTarballPath ?? LAUNCHER_TARBALL_PATH;
  const platformDirectory = options.platformDirectory ?? PLATFORM_DIRECTORY;
  const platformTarballDirectory = options.platformTarballDirectory ?? PLATFORM_TARBALL_DIRECTORY;
  const platformTarballMode = options.platformTarballMode ?? "pack";
  const manifest = parseJson(await readFile(launcherManifestPath, "utf8"), launcherManifestPath);
  if (
    !isJsonObject(manifest) ||
    typeof manifest.name !== "string" ||
    typeof manifest.version !== "string"
  ) {
    throw new Error(`[publish] invalid launcher manifest: ${launcherManifestPath}`);
  }

  if (platformTarballMode === "pack") {
    await rm(platformTarballDirectory, { recursive: true, force: true });
  }
  await mkdir(platformTarballDirectory, { recursive: true });
  const candidates: LocalPackageCandidate[] = [];
  if (platformTarballMode === "pack") {
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
  } else {
    const tarballNames = (await readdir(platformTarballDirectory))
      .filter((name) => name.endsWith(".tgz"))
      .sort();
    if (tarballNames.length !== PLATFORM_PACKAGE_NAMES.length) {
      throw new Error(
        `[publish] expected ${PLATFORM_PACKAGE_NAMES.length} preserved platform tarballs, found ${tarballNames.length}.`,
      );
    }
    const inspected = new Map<string, LocalPackageCandidate>();
    for (const tarballName of tarballNames) {
      const tarballPath = join(platformTarballDirectory, tarballName);
      const packed = await inspectTarball(options.command, tarballPath, tarballName);
      if (inspected.has(packed.name)) {
        throw new Error(`[publish] duplicate preserved tarball for ${packed.name}.`);
      }
      inspected.set(packed.name, {
        name: packed.name,
        version: packed.version,
        tarballPath,
        integrity: packed.integrity,
        role: "platform",
      });
    }
    for (const name of PLATFORM_PACKAGE_NAMES) {
      const candidate = inspected.get(name);
      if (!candidate) throw new Error(`[publish] preserved tarball for ${name} is missing.`);
      candidates.push(candidate);
    }
  }

  const launcher = await inspectTarball(options.command, launcherTarballPath, "launcher");
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

function structuredNpmError(result: CommandResult): JsonObject | null {
  for (const output of [result.stdout, result.stderr]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output) as unknown;
    } catch {
      continue;
    }
    if (isJsonObject(parsed) && isJsonObject(parsed.error)) return parsed.error;
  }
  return null;
}

function canonical404PackageName(summary: string): string | null {
  const prefixes = ["404 Not Found - GET ", "Not Found - GET "];
  const prefix = prefixes.find((candidate) => summary.startsWith(candidate));
  if (!prefix) return null;

  const remainder = summary.slice(prefix.length);
  const firstSpace = remainder.indexOf(" ");
  const urlText = firstSpace === -1 ? remainder : remainder.slice(0, firstSpace);
  try {
    const pathname = new URL(urlText).pathname;
    return decodeURIComponent(pathname.startsWith("/") ? pathname.slice(1) : pathname);
  } catch {
    return null;
  }
}

function hasExactDetailLine(detail: string, expected: string): boolean {
  return detail.split("\n").some((line) => line.trim() === expected);
}

function npmNotFound(result: CommandResult, candidate: LocalPackageCandidate): boolean {
  const error = structuredNpmError(result);
  if (
    error?.code !== "E404" ||
    typeof error.summary !== "string" ||
    typeof error.detail !== "string"
  ) {
    return false;
  }

  const summary = error.summary.trim();
  const detail = error.detail.trim();
  const packageSpec = `${candidate.name}@${candidate.version}`;
  const missingPackage =
    canonical404PackageName(summary) === candidate.name &&
    (hasExactDetailLine(detail, `'${packageSpec}' is not in this registry.`) ||
      hasExactDetailLine(detail, `'${candidate.name}' is not in this registry.`) ||
      hasExactDetailLine(
        detail,
        `The requested resource '${packageSpec}' could not be found or you do not have permission to access it.`,
      ));
  const missingVersion =
    summary === `No match found for version ${candidate.version}` &&
    hasExactDetailLine(
      detail,
      `The requested resource '${packageSpec}' could not be found or you do not have permission to access it.`,
    );
  return missingPackage || missingVersion;
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
    if (npmNotFound(result, candidate)) return null;
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

function describeSpecs(candidates: readonly LocalPackageCandidate[]): string {
  return candidates.map((candidate) => `${candidate.name}@${candidate.version}`).join(", ");
}

/** npm's refusal to overwrite a version, which here means the write did land. */
function isAlreadyPublished(result: CommandResult): boolean {
  return /cannot publish over|previously published version|EPUBLISHCONFLICT/i.test(
    `${result.stdout}\n${result.stderr}`,
  );
}

/** Issue one `npm publish`; a refusal to overwrite counts as the write existing. */
async function publishOnce(
  candidate: LocalPackageCandidate,
  options: ReconcileNpmPublicationOptions,
): Promise<void> {
  const request: CommandRequest = {
    command: "npm",
    args: ["publish", candidate.tarballPath, "--access", "public", "--provenance"],
    cwd: ROOT,
  };
  const result = await options.command(request);

  // Always surfaced, not only on failure. A slow publish exits 0, so a run
  // that hits one otherwise has npm's output captured and discarded, leaving
  // nothing to diagnose from.
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  if (output) {
    options.log?.(`[publish] npm output for ${candidate.name}@${candidate.version}:\n${output}`);
  }

  if (result.exitCode === 0) return;
  if (!isAlreadyPublished(result)) throw commandError("npm publish", request, result);
  options.log?.(
    `[publish] ${candidate.name}@${candidate.version} already on the registry; verifying instead`,
  );
}

/**
 * One visibility window for a set of just-written packages: poll every absent
 * one each round, back off between rounds, and return whatever is still absent
 * when the window closes. A package that appears is verified on that first
 * read, so a wrong artifact fails immediately instead of being retried.
 */
async function pollVisibilityWindow(
  candidates: readonly LocalPackageCandidate[],
  options: ReconcileNpmPublicationOptions,
): Promise<LocalPackageCandidate[]> {
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let absent = [...candidates];
  for (let attempt = 1; ; attempt += 1) {
    const stillAbsent: LocalPackageCandidate[] = [];
    for (const candidate of absent) {
      const metadata = await options.registry.queryMetadata(candidate);
      if (metadata === null) stillAbsent.push(candidate);
      else assertVerified(candidate, metadata);
    }
    if (stillAbsent.length === 0 || attempt >= PUBLISH_VISIBILITY_ATTEMPTS) return stillAbsent;

    const delay = publishVisibilityDelayMs(attempt);
    options.log?.(
      `[publish] not visible yet: ${describeSpecs(stillAbsent)}; retry ${attempt}/${PUBLISH_VISIBILITY_ATTEMPTS - 1} in ${Math.round(delay / 1000)}s`,
    );
    await wait(delay);
    absent = stillAbsent;
  }
}

/**
 * Confirm every written package is on the registry with the expected bytes,
 * reissuing a write only after a whole window still shows nothing for it.
 */
async function awaitVisible(
  candidates: readonly LocalPackageCandidate[],
  options: ReconcileNpmPublicationOptions,
): Promise<void> {
  if (candidates.length === 0) return;
  let absent = [...candidates];
  for (let write = 1; ; write += 1) {
    absent = await pollVisibilityWindow(absent, options);
    if (absent.length === 0) return;
    if (write >= PUBLISH_WRITE_ATTEMPTS) {
      throw new Error(
        `[publish] verification failed for ${describeSpecs(absent)}; still not found after ` +
          `${PUBLISH_WRITE_ATTEMPTS} writes and ${PUBLISH_VISIBILITY_ATTEMPTS} reads each.`,
      );
    }
    for (const candidate of absent) {
      options.log?.(
        `[publish] ${candidate.name}@${candidate.version} still absent after a successful publish; reissuing (${write}/${PUBLISH_WRITE_ATTEMPTS - 1})`,
      );
      await publishOnce(candidate, options);
    }
  }
}

async function decide(
  candidate: LocalPackageCandidate,
  options: ReconcileNpmPublicationOptions,
): Promise<PublicationDecision> {
  const decision = reconcileCandidate(candidate, await options.registry.queryIntegrity(candidate));
  options.log?.(
    `[publish] ${decision.action} ${candidate.name}@${candidate.version} (${candidate.integrity})`,
  );
  return decision;
}

/**
 * A skipped candidate was already on the registry before this run, so its
 * metadata is visible now; only the read after our own write can lag.
 */
async function verifySkipped(
  decisions: readonly PublicationDecision[],
  options: ReconcileNpmPublicationOptions,
): Promise<void> {
  for (const decision of decisions) {
    if (decision.action !== "skip") continue;
    assertVerified(decision.candidate, await options.registry.queryMetadata(decision.candidate));
  }
}

/**
 * Reconcile validated candidates in three phases, preserving launcher-last
 * safety:
 *
 * 1. decide every platform package before writing any, so a conflicting
 *    version anywhere in the set halts with nothing new on the registry;
 * 2. write every missing platform package back to back, then wait out one
 *    shared visibility window for all of them;
 * 3. only once all eight are read back with the expected bytes, decide and
 *    write the launcher and wait for it.
 *
 * The launcher is the only package users resolve by name, so what matters is
 * that it never exists before the exact-version platform packages it pins. A
 * platform package that is live while its siblings are still being applied is
 * invisible to users, which is what makes waiting once for the whole set safe.
 */
export async function reconcileNpmPublication(
  options: ReconcileNpmPublicationOptions,
): Promise<PublicationDecision[]> {
  await validateLocalCandidates(options.candidates);
  const platforms = options.candidates.filter((candidate) => candidate.role === "platform");
  const launcher = options.candidates.find((candidate) => candidate.role === "launcher")!;

  const platformDecisions: PublicationDecision[] = [];
  for (const candidate of platforms) platformDecisions.push(await decide(candidate, options));
  await verifySkipped(platformDecisions, options);

  if (options.confirmed) {
    const pending = platformDecisions
      .filter((decision) => decision.action === "publish")
      .map((decision) => decision.candidate);
    for (const candidate of pending) await publishOnce(candidate, options);
    if (pending.length > 0) {
      options.log?.(
        `[publish] wrote ${pending.length} platform package(s); waiting for the registry to apply them`,
      );
    }
    await awaitVisible(pending, options);
  }

  const launcherDecision = await decide(launcher, options);
  if (options.confirmed && launcherDecision.action === "publish") {
    await publishOnce(launcher, options);
    await awaitVisible([launcher], options);
  } else {
    await verifySkipped([launcherDecision], options);
  }
  return [...platformDecisions, launcherDecision];
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
  // npm's Node launcher can exit before Bun's async pipe reader receives its
  // small JSON payload. The synchronous Bun primitive preserves that output;
  // publication is deliberately sequential already.
  const process = Bun.spawnSync([request.command, ...request.args], {
    cwd: request.cwd ?? ROOT,
  });
  return {
    exitCode: process.exitCode,
    stdout: process.stdout.toString(),
    stderr: process.stderr.toString(),
  };
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--prepare") {
    const candidates = await buildLocalPackageCandidates({
      command: defaultCommandPort,
      platformTarballMode: "pack",
    });
    console.log(
      `[publish] prepared ${candidates.length} preserved packages at ${candidates[0]?.version}.`,
    );
    return;
  }
  const { confirmed } = parsePublishArgs(args);
  const candidates = await buildLocalPackageCandidates({
    command: defaultCommandPort,
    platformTarballMode: "inspect",
  });
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
