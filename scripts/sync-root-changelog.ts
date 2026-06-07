#!/usr/bin/env bun
// Mirror the just-versioned entry from apps/cli/CHANGELOG.md to the repo-root
// CHANGELOG.md, prefixed with `v` (e.g. v0.2.5).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseRootChangelogEntry, parseTopCliChangelogEntry } from "./release-changelog.ts";

const REPO_ROOT = join(import.meta.dirname, "..");
const CLI_CHANGELOG = join(REPO_ROOT, "apps/cli/CHANGELOG.md");
const ROOT_CHANGELOG = join(REPO_ROOT, "CHANGELOG.md");
const CLI_PKG = join(REPO_ROOT, "apps/cli/package.json");

function main(): void {
  if (!existsSync(CLI_CHANGELOG)) {
    console.error("[sync-root-changelog] apps/cli/CHANGELOG.md not found. Skipping.");
    return;
  }

  const cliContent = readFileSync(CLI_CHANGELOG, "utf8");
  const top = parseTopCliChangelogEntry(cliContent);
  if (!top) {
    console.log("[sync-root-changelog] No per-package entry to mirror. Skipping.");
    return;
  }

  if (!existsSync(CLI_PKG)) {
    console.error("[sync-root-changelog] apps/cli/package.json not found. Skipping.");
    return;
  }
  const pkgVersion = (JSON.parse(readFileSync(CLI_PKG, "utf8")) as { version?: string }).version;
  if (!pkgVersion) {
    console.error("[sync-root-changelog] apps/cli/package.json has no version. Skipping.");
    return;
  }
  if (top.version !== pkgVersion) {
    console.warn(
      `[sync-root-changelog] Per-package top (${top.version}) does not match apps/cli/package.json (${pkgVersion}). Skipping to avoid drift.`,
    );
    return;
  }

  const rootKey = `v${top.version}`;
  const rootContent = existsSync(ROOT_CHANGELOG) ? readFileSync(ROOT_CHANGELOG, "utf8") : null;
  if (rootContent !== null && parseRootChangelogEntry(rootContent, rootKey) !== null) {
    console.log(`[sync-root-changelog] Root already has ${rootKey}. Skipping.`);
    return;
  }

  const newSection = `## ${rootKey}\n\n${top.body}\n`;
  let newRoot: string;
  if (rootContent === null) {
    newRoot = `# Changelog\n\n${newSection}\n`;
  } else if (/^# Changelog\s*$/m.test(rootContent)) {
    newRoot = rootContent.replace(/^(# Changelog[ \t]*\n+)/, `$1${newSection}\n`);
  } else {
    newRoot = `# Changelog\n\n${newSection}\n\n${rootContent}`;
  }

  writeFileSync(ROOT_CHANGELOG, newRoot, "utf8");
  console.log(`[sync-root-changelog] Wrote ${rootKey} to root CHANGELOG.md`);
}

main();
