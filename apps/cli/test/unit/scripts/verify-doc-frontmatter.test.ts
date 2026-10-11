import { describe, expect, test } from "bun:test";

import { docIsReconciled } from "../../../../../scripts/verify-doc-frontmatter";

/**
 * `docIsReconciled` is pure over the patch text, the head frontmatter value,
 * and the pinned day. It encodes the freshness contract — a doc a change set
 * touched counts as reconciled when its review date moved, or when it already
 * says today because a same-day change cannot move it again.
 */
describe("docIsReconciled", () => {
  const today = "2026-10-11";

  test("a patch that moves lastReviewed is reconciled", () => {
    const patch = [
      "@@ -1,5 +1,5 @@",
      " status: current",
      '-lastReviewed: "2026-10-07"',
      '+lastReviewed: "2026-10-11"',
      " ---",
    ].join("\n");

    expect(docIsReconciled(patch, "2026-10-11", today)).toBe(true);
  });

  test("an unchanged lastReviewed that already says today is reconciled", () => {
    // Two same-day edits cannot each move the date: when the base already set
    // lastReviewed to today, a second change touching the body must not fail.
    const patch = [
      "@@ -40,3 +40,4 @@",
      " unchanged context line",
      "+added prose body line",
      " another context line",
    ].join("\n");

    expect(docIsReconciled(patch, "2026-10-11", today)).toBe(true);
  });

  test("an unchanged stale lastReviewed is not reconciled", () => {
    const patch = ["@@ -40,3 +40,4 @@", " context", "+added prose body line"].join("\n");

    expect(docIsReconciled(patch, "2026-09-30", today)).toBe(false);
    expect(docIsReconciled(patch, undefined, today)).toBe(false);
    expect(docIsReconciled(null, "2026-09-30", today)).toBe(false);
  });
});
