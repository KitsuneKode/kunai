#!/usr/bin/env bun
// Release guard: keeps the published CLI version and the changelogs in lock-step.
//
// What it checks:
//   1. The version in apps/cli/package.json must match the highest `## X.Y.Z`
//      entry in apps/cli/CHANGELOG.md.
//   2. If the repo-root CHANGELOG.md exists, it must contain `## vX.Y.Z` for
//      the current package version (not just an older highest entry).
//   3. If apps/cli/package.json has been bumped, a `.changeset/*.md` naming the
//      published package must exist (or the change must already be reflected in
//      apps/cli/CHANGELOG.md).
//   4. A staged, unpublished release cannot carry loose changesets, because
//      Changesets would version them on top of the release that has not shipped.
//
// Rules 3 and 4 both read the same package-scoped list: a changeset that names
// no package (an empty bookkeeping file) or names a different one cannot bump
// the published package, so neither rule should react to it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type ReleasePublicationStatus } from "./release-artifact.ts";
import { compareSemver, highestChangelogVersion } from "./release-changelog.ts";
import { assertNpmPlatformVersionsSynchronized } from "./sync-npm-platform-versions.ts";

// Typed so renaming the union member upstream fails typecheck here rather than
// leaving rule 4 silently comparing against a status that no longer exists.
const STAGED: ReleasePublicationStatus = "staged";

const REPO_ROOT = join(import.meta.dirname, "..");
const CLI_PKG = join(REPO_ROOT, "apps/cli/package.json");
const CLI_CHANGELOG = join(REPO_ROOT, "apps/cli/CHANGELOG.md");
const ROOT_CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");
const CHANGESET_DIR = join(REPO_ROOT, ".changeset");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function changesetTargetsPackage(contents: string, packageName: string): boolean {
  const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter) return false;
  return frontmatter.split(/\r?\n/).some((line) => {
    const separator = line.indexOf(":");
    if (separator < 0) return false;
    const rawKey = line.slice(0, separator).trim();
    const key = rawKey.replace(/^(["'])(.*)\1$/, "$2");
    return key === packageName;
  });
}

function listPackageChangesetFiles(packageName: string): string[] {
  if (!existsSync(CHANGESET_DIR)) return [];
  return readdirSync(CHANGESET_DIR).filter((file) => {
    if (!file.endsWith(".md") || file === "README.md") return false;
    return changesetTargetsPackage(readText(join(CHANGESET_DIR, file)), packageName);
  });
}

export interface ReleaseGuardInputs {
  readonly packageManifest: unknown;
  readonly cliChangelog: string;
  readonly rootChangelog: string | null;
  readonly changesetFiles: readonly string[];
  readonly currentReleaseArtifact?: unknown;
}

export function collectReleaseGuardErrors({
  packageManifest,
  cliChangelog,
  rootChangelog,
  changesetFiles,
  currentReleaseArtifact,
}: ReleaseGuardInputs): string[] {
  const errors: string[] = [];
  const pkg = packageManifest as { version?: string; name?: string };
  const cliVersion = pkg.version;
  if (!cliVersion) {
    errors.push(`apps/cli/package.json has no "version" field.`);
    return errors;
  }
  // Rules 3 and 4 scope changesets by package name. Without one, main() cannot
  // build that list, so both rules would go quiet instead of failing closed.
  if (!pkg.name) {
    errors.push(`apps/cli/package.json has no "name" field, so changesets cannot be scoped to it.`);
    return errors;
  }

  try {
    assertNpmPlatformVersionsSynchronized(packageManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`apps/cli/package.json platform pins are invalid: ${message}`);
  }

  const cliChangelogTop = highestChangelogVersion(cliChangelog, "## ");
  if (!cliChangelogTop) {
    errors.push(`apps/cli/CHANGELOG.md has no \`## X.Y.Z\` entries.`);
  } else if (cliChangelogTop !== cliVersion) {
    errors.push(
      `apps/cli/package.json version (${cliVersion}) does not match the highest entry in apps/cli/CHANGELOG.md (${cliChangelogTop}). Run \`bun run version:packages\` to reconcile.`,
    );
  }

  if (rootChangelog !== null) {
    const rootTop = highestChangelogVersion(rootChangelog, "## v");
    if (!rootTop) {
      errors.push(
        `Root CHANGELOG.md has no \`## vX.Y.Z\` entries. Expected \`## v${cliVersion}\`. Run \`bun run version:packages\` to mirror from apps/cli/CHANGELOG.md.`,
      );
    } else if (rootTop !== cliVersion) {
      errors.push(
        `Root CHANGELOG.md highest entry is v${rootTop}, but apps/cli/package.json is at ${cliVersion}. Run \`bun run version:packages\` to reconcile.`,
      );
    }
  }

  if (cliChangelogTop && compareSemver(cliVersion, cliChangelogTop) > 0) {
    if (changesetFiles.length === 0) {
      errors.push(
        `apps/cli/package.json (${cliVersion}) is ahead of apps/cli/CHANGELOG.md (${cliChangelogTop}) but no .changeset/*.md names ${pkg.name}. Add a changeset describing the bump.`,
      );
    }
  }

  const releaseArtifact = currentReleaseArtifact as {
    readonly version?: unknown;
    readonly status?: unknown;
  } | null;
  if (
    changesetFiles.length > 0 &&
    releaseArtifact?.version === cliVersion &&
    releaseArtifact.status === STAGED
  ) {
    errors.push(
      `Pending changesets (${changesetFiles.join(", ")}) would version on top of staged, unpublished ${cliVersion}. Fold them into the staged release notes and consume them, or publish ${cliVersion} first.`,
    );
  }

  return errors;
}

function readCurrentReleaseArtifact(packageManifest: unknown): unknown | null {
  const version = (packageManifest as { readonly version?: unknown }).version;
  if (typeof version !== "string" || !version) return null;
  const path = join(REPO_ROOT, ".release", `kunai-v${version}.json`);
  return existsSync(path) ? readJson(path) : null;
}

function main(): void {
  const packageManifest = readJson(CLI_PKG);
  const packageName = (packageManifest as { readonly name?: unknown }).name;
  const errors = collectReleaseGuardErrors({
    packageManifest,
    cliChangelog: readText(CLI_CHANGELOG),
    rootChangelog: existsSync(ROOT_CHANGELOG) ? readText(ROOT_CHANGELOG) : null,
    changesetFiles: typeof packageName === "string" ? listPackageChangesetFiles(packageName) : [],
    currentReleaseArtifact: readCurrentReleaseArtifact(packageManifest),
  });
  printAndExit(errors);
}

function printAndExit(errors: string[]): void {
  const cliVersion = (() => {
    try {
      return (readJson(CLI_PKG) as { version?: string }).version ?? "?";
    } catch {
      return "?";
    }
  })();
  if (errors.length === 0) {
    console.log(`[release-guard] OK — @kitsunekode/kunai@${cliVersion} is in sync.`);
    return;
  }
  console.error(`[release-guard] FAILED for @kitsunekode/kunai@${cliVersion}:`);
  for (const e of errors) {
    console.error(`  - ${e}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  main();
}
