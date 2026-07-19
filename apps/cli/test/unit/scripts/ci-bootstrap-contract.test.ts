import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// A *local* composite action (`uses: ./.github/actions/...`) can only be
// resolved once the repository is on disk. A job whose first step is such an
// action fails before any checkout inside that action could run, which silently
// broke the release workflow: the composite carried its own checkout, so
// release.yml had none of its own and never reached the publish/binaries steps.
//
// These are text-level assertions on purpose — no YAML dependency, and they
// fail loudly the moment someone reintroduces the pattern.

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const COMPOSITE = join(REPO_ROOT, ".github/actions/setup-bun-monorepo/action.yml");

const LOCAL_COMPOSITE_USE = /uses:\s*\.\/\.github\/actions\//;
const CHECKOUT_USE = /uses:\s*actions\/checkout@/;
const JOB_STEPS_START = /^\s{4,6}steps:\s*$/;

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(WORKFLOW_DIR, name));
}

/** Local-composite uses that are not preceded by a checkout in the same job. */
function violationsIn(file: string): string[] {
  const violations: string[] = [];
  let checkedOut = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (JOB_STEPS_START.test(line)) checkedOut = false;
    if (CHECKOUT_USE.test(line)) checkedOut = true;
    if (LOCAL_COMPOSITE_USE.test(line) && !checkedOut) {
      violations.push(`${file}: ${line.trim()}`);
    }
  }
  return violations;
}

describe("CI bootstrap contract", () => {
  test("the shared setup composite does not check out the repository itself", () => {
    const composite = readFileSync(COMPOSITE, "utf8");
    expect(composite).not.toMatch(CHECKOUT_USE);
  });

  test("every local composite use is preceded by a checkout in the same job", () => {
    const violations = workflowFiles().flatMap(violationsIn);
    expect(violations).toEqual([]);
  });

  test("the release workflow checks out before its first composite step", () => {
    const release = readFileSync(join(WORKFLOW_DIR, "release.yml"), "utf8");
    const firstCheckout = release.search(CHECKOUT_USE);
    const firstComposite = release.search(LOCAL_COMPOSITE_USE);
    expect(firstCheckout).toBeGreaterThanOrEqual(0);
    expect(firstCheckout).toBeLessThan(firstComposite);
  });
});
