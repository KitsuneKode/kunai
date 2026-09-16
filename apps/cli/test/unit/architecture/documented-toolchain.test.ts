import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../../..");

/**
 * The prerequisites a contributor reads must match the ones the repo enforces.
 *
 * `.docs/quickstart.md` drifted to a Bun floor two minors below `engines.bun`,
 * and `docs/developer/contribute.mdx` still called the lint gate ESLint long
 * after it became oxlint. Both are the kind of rot nobody notices, because
 * nothing reads the prose. These tests read it.
 */
describe("documented toolchain matches the enforced one", () => {
  test("quickstart states the Bun floor from engines.bun", async () => {
    const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as {
      engines?: { bun?: string };
    };
    const required = pkg.engines?.bun;
    expect(required).toBeTruthy();

    const quickstart = await Bun.file(join(ROOT, ".docs/quickstart.md")).text();
    const documented = quickstart.match(/^- Bun `([^`]+)`/m)?.[1];

    expect(documented).toBe(required);
  });

  test("contributor docs name the lint tool the repo actually runs", async () => {
    const contribute = await Bun.file(join(ROOT, "docs/developer/contribute.mdx")).text();
    // The repo lints with oxlint; ESLint is not a dependency any more.
    expect(contribute).not.toMatch(/eslint/i);
  });
});
