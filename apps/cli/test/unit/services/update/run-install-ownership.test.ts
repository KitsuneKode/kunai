import { expect, test } from "bun:test";
import { join } from "node:path";

const UPDATE_ROOT = join(import.meta.dir, "../../../../src/services/update");

test("native install has no package-manager cleanup side effect", async () => {
  const source = await Bun.file(join(UPDATE_ROOT, "run-install.ts")).text();

  expect(source).not.toContain("cleanupNpmInstallations");
  expect(source).not.toMatch(/\b(?:npm|bun)\b.*\b(?:uninstall|remove)\b/);
});
