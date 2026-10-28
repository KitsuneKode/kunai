import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

let passed = 0;
let failed = 0;
function test(name, check) {
  try {
    check();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

const rootRequire = createRequire(new URL("../package.json", import.meta.url));

// The generator was used only for its stylesheet. Keep its unpatched merge/glob
// graph out of builds; a future reintroduction needs an explicit security review.
test("retired generator and vulnerable merge/glob graph stay out of the lockfile", () => {
  const lock = readFileSync(new URL("../bun.lock", import.meta.url), "utf8");
  for (const name of ["shadcn", "@shadcn/registry", "deepmerge", "braces", "micromatch"]) {
    assert.doesNotMatch(lock, new RegExp(`"${name}"\\s*:`), `${name} requires renewed qualification`);
  }
  const docs = JSON.parse(readFileSync(new URL("../apps/docs/package.json", import.meta.url), "utf8"));
  assert.equal(docs.dependencies.shadcn, undefined);
  assert.equal(docs.devDependencies.shadcn, undefined);
  const root = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(root.patchedDependencies?.["braces@3.0.3"], undefined);
});

// Read declared installed edges, not hoisted packages left by an older install.
const changesetsRequire = createRequire(rootRequire.resolve("@changesets/cli"));
for (const name of ["@changesets/config", "@changesets/git"]) {
  test(`${name}: current glob dependency avoids braces`, () => {
    const manifest = JSON.parse(
      readFileSync(changesetsRequire.resolve(`${name}/package.json`), "utf8"),
    );
    assert.match(manifest.dependencies.picomatch, /[0-9]/);
    assert.equal(manifest.dependencies.micromatch, undefined);
    assert.equal(manifest.dependencies.braces, undefined);
  });
}

console.log(`Dependency patch checks: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
