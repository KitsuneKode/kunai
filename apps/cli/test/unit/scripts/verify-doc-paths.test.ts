import { describe, expect, test } from "bun:test";

import { checkRoadmap } from "../../../../../scripts/verify-doc-paths";

/**
 * `checkRoadmap` is pure over its two inputs: the roadmap text and the names
 * in `.plans/`. It encodes the two mechanical halves of the index contract —
 * every plan file is linked, and a LANDED row points into `.archive/`. The
 * third half — whether a TODO row is actually finished — stays human and is
 * deliberately not asserted.
 */
describe("checkRoadmap", () => {
  test("an unindexed plan file is a finding", () => {
    const roadmap = "| [064](./064-foo.md) | — | work | TODO |\n";
    const findings = checkRoadmap(roadmap, ["064-foo.md", "065-bar.md", "roadmap.md"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(".plans/065-bar.md");
    expect(findings[0]?.target).toContain("not indexed");
  });

  test("roadmap.md itself is never expected to be indexed", () => {
    const findings = checkRoadmap("| [064](./064-foo.md) | — | work | TODO |\n", [
      "064-foo.md",
      "roadmap.md",
    ]);
    expect(findings).toHaveLength(0);
  });

  test("a LANDED row pointing into .plans/ is a finding", () => {
    const roadmap = "| [048](./048-foo.md) | #1 | none — landed | LANDED |\n";
    const findings = checkRoadmap(roadmap, ["048-foo.md"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(".plans/roadmap.md");
    expect(findings[0]?.target).toContain(".archive/");
  });

  test("a LANDED row pointing into .archive/ passes", () => {
    const roadmap = "| [048](../.archive/plans/048-foo.md) | #1 | none | LANDED via #293 |\n";
    const findings = checkRoadmap(roadmap, []);
    expect(findings).toHaveLength(0);
  });

  test("a PARTIAL row may point into .archive/ — the residue convention", () => {
    // A landed core moves to .archive/ while the row keeps its leftover work;
    // only the TODO shape would be contradictory.
    const roadmap = "| [054](../.archive/plans/054-foo.md) | #2 | contract landed | PARTIAL |\n";
    const findings = checkRoadmap(roadmap, []);
    expect(findings).toHaveLength(0);
  });

  test("a TODO row pointing into .plans/ passes", () => {
    const roadmap = "| [064](./064-foo.md) | — | work | TODO |\n";
    expect(checkRoadmap(roadmap, ["064-foo.md"])).toHaveLength(0);
  });

  test("links in prose lines without table cells carry no status check", () => {
    const roadmap = "See [the old plan](../.archive/plans/099-foo.md) for history.\n";
    expect(checkRoadmap(roadmap, [])).toHaveLength(0);
  });

  test("an indexed file linked via a non-.md anchor still counts only as a link", () => {
    // Only .md files under .plans/ are required to be indexed; a roadmap link
    // to a .docs file does not index a plan.
    const roadmap = "| [runtime](../.docs/mobile-terminal-runtime.md) | #3 | work | TODO |\n";
    const findings = checkRoadmap(roadmap, ["099-foo.md"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(".plans/099-foo.md");
  });
});
