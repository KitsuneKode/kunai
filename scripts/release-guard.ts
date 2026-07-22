#!/usr/bin/env bun
// Release guard: keeps the published CLI version and the changelogs in lock-step.
//
// What it checks:
//   1. The version in apps/cli/package.json must match the highest `## X.Y.Z`
//      entry in apps/cli/CHANGELOG.md.
//   2. If the repo-root CHANGELOG.md exists, it must contain `## vX.Y.Z` for
//      the current package version (not just an older highest entry).
//   3. If apps/cli/package.json has been bumped, a `.changeset/*.md` must
//      exist (or the change must already be reflected in apps/cli/CHANGELOG.md).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { compareSemver, highestChangelogVersion } from "./release-changelog.ts";
import { assertNpmPlatformVersionsSynchronized } from "./sync-npm-platform-versions.ts";

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

function listChangesetFiles(): string[] {
  if (!existsSync(CHANGESET_DIR)) return [];
  return readdirSync(CHANGESET_DIR).filter(
    (f) => f.endsWith(".md") && f !== "README.md" && f !== "config.json",
  );
}

export interface ReleaseGuardInputs {
  readonly packageManifest: unknown;
  readonly cliChangelog: string;
  readonly rootChangelog: string | null;
  readonly changesetFiles: readonly string[];
}

export function collectReleaseGuardErrors({
  packageManifest,
  cliChangelog,
  rootChangelog,
  changesetFiles,
}: ReleaseGuardInputs): string[] {
  const errors: string[] = [];
  const pkg = packageManifest as { version?: string; name?: string };
  const cliVersion = pkg.version;
  if (!cliVersion) {
    errors.push(`apps/cli/package.json has no "version" field.`);
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
        `apps/cli/package.json (${cliVersion}) is ahead of apps/cli/CHANGELOG.md (${cliChangelogTop}) but no .changeset/*.md exists. Add a changeset describing the bump.`,
      );
    }
  }

  return errors;
}

function main(): void {
  const errors = collectReleaseGuardErrors({
    packageManifest: readJson(CLI_PKG),
    cliChangelog: readText(CLI_CHANGELOG),
    rootChangelog: existsSync(ROOT_CHANGELOG) ? readText(ROOT_CHANGELOG) : null,
    changesetFiles: listChangesetFiles(),
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
