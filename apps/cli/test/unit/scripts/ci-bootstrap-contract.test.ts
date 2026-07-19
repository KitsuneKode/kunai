import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  findAllViolations,
  findCheckoutOrderViolations,
  findCompositeCheckoutViolations,
  REPO_ROOT,
} from "../../../../../scripts/ci-bootstrap-contract";

// A *local* composite action (`uses: ./.github/actions/...`) can only be
// resolved once the repository is on disk. A job whose first step is such an
// action fails before any checkout inside that action could run — which is how
// the release workflow broke silently while every local gate stayed green.
//
// The rule itself lives in scripts/ci-bootstrap-contract.ts so CI, this test,
// and a human running it by hand all share one implementation.

describe("CI bootstrap contract", () => {
  test("the shared setup composite does not check out the repository itself", () => {
    expect(findCompositeCheckoutViolations()).toEqual([]);
  });

  test("every local composite use is preceded by a checkout in the same job", () => {
    expect(findCheckoutOrderViolations()).toEqual([]);
  });

  test("the checked-in workflows satisfy the whole contract", () => {
    expect(findAllViolations()).toEqual([]);
  });

  test("the release workflow checks out before its first composite step", () => {
    // Guards the specific regression: release.yml previously relied entirely on
    // the composite's internal checkout and therefore never reached publish.
    const release = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
    const firstCheckout = release.search(/uses:\s*actions\/checkout@/);
    const firstComposite = release.search(/uses:\s*\.\/\.github\/actions\//);
    expect(firstCheckout).toBeGreaterThanOrEqual(0);
    expect(firstComposite).toBeGreaterThanOrEqual(0);
    expect(firstCheckout).toBeLessThan(firstComposite);
  });
});
