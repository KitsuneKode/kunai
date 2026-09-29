#!/usr/bin/env bun
/**
 * verify:parity-references — keep upstream-reference version cites honest.
 *
 * Provider dossiers and manifests cite the upstream reference implementation
 * (ani-cli) by version. Without a pin those cites drift: the same checkout was
 * cited at four different versions across the tree, and none of them matched
 * what was actually on disk. This script enforces both directions:
 *
 *  1. Repo → pin: every `ani-cli`-style semver cite in manifests and dossiers
 *     must equal the pinned version, sit on a line carrying a full `YYYY-MM-DD`
 *     date (a dated historical record), or be marked historical ("removed",
 *     "deleted", …). A bare stale cite claims currency it doesn't have.
 *  2. Pin → checkout: when the local upstream checkout exists, its
 *     `version_number` must equal the pin — that is the freshness signal the
 *     pin exists for. Missing checkouts skip cleanly (CI has none).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type ParityReference = {
  readonly version: string;
  readonly commit: string;
  readonly upstream: string;
  readonly localCheckout: string;
};

// SAFETY: the pin file is repo-owned and shape-checked by the reference validation below.
const PIN_FILE = JSON.parse(readFileSync(join(ROOT, "scripts/parity-references.json"), "utf8")) as {
  readonly references: Record<string, ParityReference>;
};

/** Directories whose markdown/ts cites are checked. .archive/.reference are history. */
const SCANNED_ROOTS = ["packages/providers/src", ".docs"];
const SCANNED_EXTENSIONS = /\.(ts|md)$/;

// Same exemption vocabulary as verify-doc-paths.ts — a line citing a version
// while recording that the thing cited is gone is not claiming currency.
const HISTORICAL_MARKERS = [
  "removed",
  "deleted",
  "retired",
  "no longer exists",
  "not built",
  "does not exist",
];
const FULL_DATE = /\d{4}-\d{2}-\d{2}/;

type Finding = { readonly file: string; readonly line: number; readonly cite: string };

/** Collect files under `root` (a repo-relative dir or file) matching the extension filter. */
function collectFiles(root: string): readonly string[] {
  const absolute = join(ROOT, root);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) {
    return SCANNED_EXTENSIONS.test(root) ? [root] : [];
  }
  return Array.from(new Bun.Glob("**/*").scanSync({ cwd: absolute, onlyFiles: true }))
    .filter((entry) => SCANNED_EXTENSIONS.test(entry))
    .map((entry) => join(root, entry));
}

function isHistorical(line: string): boolean {
  const normalized = line.toLowerCase().replace(/[*_`]/g, "");
  return HISTORICAL_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Cite pattern for one reference name: `ani-cli v5.1.2`, `ani-cli `5.1.2``,
 * `ani-cli 5.1.2`. Major-only cites ("ani-cli v5") are deliberately not
 * semver-checked — they describe an era, not a pin.
 */
function citePattern(name: string): RegExp {
  return new RegExp(`${name}\\s*\`?v?(\\d+\\.\\d+\\.\\d+)`, "gi");
}

/** Scans one file for stale version cites of `name`. Exported for tests. */
export function citeFindings(
  file: string,
  text: string,
  name: string,
  pinnedVersion: string,
): readonly Finding[] {
  const findings: Finding[] = [];
  const pattern = citePattern(name);
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      const cited = match[1];
      if (!cited || cited === pinnedVersion) continue;
      if (isHistorical(line) || FULL_DATE.test(line)) continue;
      findings.push({ file, line: index + 1, cite: `${name} ${cited}` });
    }
  });
  return findings;
}

/** Reads the upstream script's `version_number` when a local checkout exists. */
export function localCheckoutVersion(checkout: string, scriptName: string): string | null {
  const expanded = checkout.startsWith("~/") ? join(homedir(), checkout.slice(2)) : checkout;
  const scriptPath = join(expanded, scriptName);
  if (!existsSync(scriptPath)) return null;
  const match = /version_number="([^"]+)"/.exec(readFileSync(scriptPath, "utf8"));
  return match?.[1] ?? null;
}

function main(): void {
  const findings: Finding[] = [];
  const warnings: string[] = [];

  for (const [name, reference] of Object.entries(PIN_FILE.references)) {
    for (const root of SCANNED_ROOTS) {
      for (const file of collectFiles(root)) {
        findings.push(
          ...citeFindings(file, readFileSync(join(ROOT, file), "utf8"), name, reference.version),
        );
      }
    }

    const localVersion = localCheckoutVersion(reference.localCheckout, name);
    if (localVersion === null) {
      warnings.push(`  ${name}: local checkout absent — freshness check skipped`);
    } else if (localVersion !== reference.version) {
      findings.push({
        file: "scripts/parity-references.json",
        line: 0,
        cite: `${name} pin ${reference.version} ≠ local checkout ${localVersion}`,
      });
    }
  }

  for (const warning of warnings) console.warn(warning);

  if (findings.length > 0) {
    console.error(`\nStale parity references (${findings.length}):\n`);
    for (const { file, line, cite } of findings) {
      console.error(`  ${file}${line > 0 ? `:${line}` : ""}  →  ${cite}`);
    }
    console.error(
      `\nUpdate the cite to the pin, port the upstream delta first, or mark the line
historical (a full YYYY-MM-DD date or "removed"/"deleted" wording).\n`,
    );
    process.exit(1);
  }

  console.log("verify:parity-references — all cites match scripts/parity-references.json.");
}

if (import.meta.main) main();
