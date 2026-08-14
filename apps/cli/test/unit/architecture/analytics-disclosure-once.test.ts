import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../../../src");

function read(relativePath: string): string {
  return readFileSync(join(SRC, relativePath), "utf8");
}

/**
 * A user must be told about analytics exactly once per session.
 *
 * There are two disclosure surfaces — the setup wizard's consent slide and the
 * upgrader banner — and they are wired through different paths: `main.ts`
 * raises `container.analyticsDisclosurePending` from a background startup task,
 * while the wizard writes consent on its own. Nothing in the type system stops
 * both from firing, and during development both did.
 *
 * These are source-level assertions in the style of
 * `contract-conformance.test.ts`: the wizard renders Ink and awaits an
 * interactive flow, so an end-to-end test would cost far more than the
 * invariant is worth, while the invariant itself is one line of code that is
 * easy to delete by accident.
 */
describe("analytics disclosure happens once", () => {
  test("the setup wizard clears the pending flag", () => {
    const body = read("app-shell/workflows/setup-workflows.ts");
    expect(body).toContain("container.analyticsDisclosurePending = false");
  });

  test("the wizard consents through the service, never by writing keys itself", () => {
    const body = read("app-shell/workflows/setup-workflows.ts");
    expect(body).toContain("container.usageAnalytics.consentPatch");
    // A second writer of these keys is how the three-way consent split started.
    expect(body).not.toMatch(/\banalytics:\s*["']/);
    expect(body).not.toContain("installId:");
  });

  test("only main.ts raises the pending flag", () => {
    expect(read("main.ts")).toContain("container.analyticsDisclosurePending = true");
    // The shell may clear it; nothing else may set it.
    expect(read("app-shell/ink-shell.tsx")).not.toContain(
      "container.analyticsDisclosurePending = true",
    );
  });

  test("the banner surface clears the flag when it retires the notice", () => {
    expect(read("app-shell/ink-shell.tsx")).toContain(
      "container.analyticsDisclosurePending = false",
    );
  });

  test("main.ts holds no consent policy of its own", () => {
    const body = read("main.ts");
    // The CI=0 defect lived here: a hand-rolled second copy of the env gate.
    expect(body).not.toContain("DO_NOT_TRACK");
    expect(body).not.toContain("resolveTelemetryConsent");
    expect(body).toContain("onSessionStart");
  });
});
