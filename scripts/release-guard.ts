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
//
// Why it exists:
//   The v0.2.5 release was hand-prepared: package.json was bumped to 0.2.5,
//   the root CHANGELOG.md was hand-written, but apps/cli/CHANGELOG.md was
//   never updated and no changeset was added. The release workflow still
//   published the package because `changeset publish` only cares about the
//   version in package.json — it does not validate the changelog. This guard
//   closes that gap so a future hand-bump fails the release job instead of
//   shipping a half-baked release.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

function highestChangelogVersion(content: string, prefix: "## " | "## v"): string | null {
  const re = new RegExp(`^${prefix === "## v" ? "## v" : "## "}(\\d+\\.\\d+\\.\\d+)\\s*$`, "gm");
  let highest: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const v = m[1];
    if (!v) continue;
    if (highest === null || compareSemver(v, highest) > 0) {
      highest = v;
    }
  }
  return highest;
}

function compareSemver(a: string, b: string): number {
  const [aMaj, aMin, aPat] = a.split(".").map((n) => Number.parseInt(n, 10));
  const [bMaj, bMin, bPat] = b.split(".").map((n) => Number.parseInt(n, 10));
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

function listChangesetFiles(): string[] {
  if (!existsSync(CHANGESET_DIR)) return [];
  return readdirSync(CHANGESET_DIR).filter(
    (f) => f.endsWith(".md") && f !== "README.md" && f !== "config.json",
  );
}

function main(): void {
  const errors: string[] = [];
  const pkg = readJson(CLI_PKG) as { version?: string; name?: string };
  const cliVersion = pkg.version;
  if (!cliVersion) {
    errors.push(`apps/cli/package.json has no "version" field.`);
    printAndExit(errors);
    return;
  }

  const cliChangelog = readText(CLI_CHANGELOG);
  const cliChangelogTop = highestChangelogVersion(cliChangelog, "## ");
  if (!cliChangelogTop) {
    errors.push(`apps/cli/CHANGELOG.md has no \`## X.Y.Z\` entries.`);
  } else if (cliChangelogTop !== cliVersion) {
    errors.push(
      `apps/cli/package.json version (${cliVersion}) does not match the highest entry in apps/cli/CHANGELOG.md (${cliChangelogTop}). Run \`bun run version:packages\` to reconcile.`,
    );
  }

  if (existsSync(ROOT_CHANGELOG)) {
    const rootChangelog = readText(ROOT_CHANGELOG);
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

  // If the package was bumped past the changelog, a changeset must exist.
  if (cliChangelogTop && compareSemver(cliVersion, cliChangelogTop) > 0) {
    const changesets = listChangesetFiles();
    if (changesets.length === 0) {
      errors.push(
        `apps/cli/package.json (${cliVersion}) is ahead of apps/cli/CHANGELOG.md (${cliChangelogTop}) but no .changeset/*.md exists. Add a changeset describing the bump.`,
      );
    }
  }

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

main();
