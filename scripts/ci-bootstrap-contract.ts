#!/usr/bin/env bun
// =============================================================================
// ci-bootstrap-contract.ts — enforce caller-owned checkout for local composites.
//
// A *local* composite action (`uses: ./.github/actions/...`) can only be
// resolved once the repository is already on disk. If such an action performs
// its own `actions/checkout`, any job whose first step is that action fails
// before the checkout inside it can ever run.
//
// This is not hypothetical: `setup-bun-monorepo` carried its own checkout and
// `release.yml` had none of its own, so the release pipeline broke silently on
// 2026-06-27. Version 0.2.6 has a bump and release notes but no `v0.2.6` tag
// and no published binaries, and every local gate stayed green throughout.
//
// Usage:
//   bun run scripts/ci-bootstrap-contract.ts          # report, exit 1 on violation
// =============================================================================

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..");
const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const COMPOSITE_DIR = join(REPO_ROOT, ".github/actions");

const LOCAL_COMPOSITE_USE = /uses:\s*\.\/\.github\/actions\//;
const CHECKOUT_USE = /uses:\s*actions\/checkout@/;
/** `steps:` at job indent — resets checkout tracking for the next job. */
const JOB_STEPS_START = /^\s{4,6}steps:\s*$/;

export type ContractViolation = {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
};

function listYamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listYamlFiles(full);
    return entry.name.endsWith(".yml") || entry.name.endsWith(".yaml") ? [full] : [];
  });
}

/** Composite actions must not check out — the caller owns it. */
export function findCompositeCheckoutViolations(): ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const file of listYamlFiles(COMPOSITE_DIR)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (CHECKOUT_USE.test(line)) {
          violations.push({
            file: relative(REPO_ROOT, file),
            line: index + 1,
            detail: "composite action performs its own checkout; move it to the callers",
          });
        }
      });
  }
  return violations;
}

/** Every local-composite use must be preceded by a checkout in the same job. */
export function findCheckoutOrderViolations(): ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const file of listYamlFiles(WORKFLOW_DIR)) {
    let checkedOut = false;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (JOB_STEPS_START.test(line)) checkedOut = false;
        if (CHECKOUT_USE.test(line)) checkedOut = true;
        if (LOCAL_COMPOSITE_USE.test(line) && !checkedOut) {
          violations.push({
            file: relative(REPO_ROOT, file),
            line: index + 1,
            detail: `local composite used before any actions/checkout: ${line.trim()}`,
          });
        }
      });
  }
  return violations;
}

export function findAllViolations(): ContractViolation[] {
  return [...findCompositeCheckoutViolations(), ...findCheckoutOrderViolations()];
}

function main(): void {
  const violations = findAllViolations();
  if (violations.length === 0) {
    console.log(
      "[ci-bootstrap-contract] OK — every local composite use is preceded by a checkout.",
    );
    return;
  }
  for (const violation of violations) {
    console.error(`✗ ${violation.file}:${violation.line} — ${violation.detail}`);
  }
  console.error(
    `\n[ci-bootstrap-contract] ${violations.length} violation(s). ` +
      "Add `- uses: actions/checkout@v5` before the composite step in each job.",
  );
  process.exit(1);
}

if (import.meta.main) {
  main();
}
