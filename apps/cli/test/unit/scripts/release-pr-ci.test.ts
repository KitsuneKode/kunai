import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync("../../.github/workflows/ci.yml", "utf8");

test("release-only script changes run a fast PR smoke job", () => {
  expect(workflow).toContain("release-scripts: ${{ steps.filter.outputs.release-scripts }}");
  for (const path of [
    ".github/workflows/release.yml",
    "scripts/publish-npm-release.ts",
    "scripts/release-gate-evidence.ts",
    "scripts/packaging/**",
    ".github/scripts/**",
  ]) {
    expect(workflow).toContain(`- '${path}'`);
  }

  expect(workflow).toContain("name: Release script PR smoke");
  expect(workflow).toContain('RELEASE_NODE_VERSION: "22.18.0"');
  expect(workflow).toContain("node-version: ${{ env.RELEASE_NODE_VERSION }}");
  expect(workflow).toContain("bash -n .github/scripts/*.sh");
  expect(workflow).toContain("shellcheck .github/scripts/*.sh");
  expect(workflow).toContain("test/unit/scripts/release-gate-evidence.test.ts");
  expect(workflow).toContain("test/unit/scripts/publish-npm-release.test.ts");
  expect(workflow).toContain("bun run release:prepare");
  expect(workflow).toContain("bun run release:pack");
  expect(workflow.indexOf("bun run release:pack")).toBeLessThan(
    workflow.indexOf("bun run release:prepare"),
  );
  expect(workflow).toContain("bun run scripts/publish-npm-release.ts --dry-run");
  expect(workflow).toContain("release-scripts,");
});
