import assert from "node:assert/strict";
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
const docsRequire = createRequire(new URL("../apps/docs/package.json", import.meta.url));

function dependencyRequire(start, chain) {
  return chain.reduce(
    (parent, name) => createRequire(parent.resolve(name)),
    start,
  );
}

const consumers = [
  ["Changesets config", rootRequire, ["@changesets/cli", "@changesets/config", "micromatch"]],
  ["Changesets git", rootRequire, ["@changesets/cli", "@changesets/git", "micromatch"]],
  ["shadcn glob", docsRequire, ["shadcn", "fast-glob", "micromatch"]],
];

function nestedAst(depth) {
  let node = { type: "text", value: "a" };
  for (let index = 0; index < depth; index++) node = { type: "paren", nodes: [node] };
  return { type: "root", nodes: [node] };
}

for (const [label, start, chain] of consumers) {
  const consumer = dependencyRequire(start, chain);
  const braces = consumer("braces");
  const micromatch = consumer(".");

  test(`${label}: installed parser rejects deeply nested braces and parentheses`, () => {
    for (const [open, close] of [["{", "}"], ["(", ")"], ["({", "})"]]) {
      const pattern = open.repeat(3000) + "a" + close.repeat(3000);
      // The mixed case exceeds the old length ceiling; keep that case below it.
      const input = pattern.length > 10000 ? open.repeat(2000) + "a" + close.repeat(2000) : pattern;
      assert.throws(() => braces.parse(input), /exceeds max depth/);
    }
  });

  for (const method of ["compile", "expand", "stringify"]) {
    test(`${label}: ${method} guards direct ASTs and cannot raise the safe ceiling`, () => {
      assert.throws(() => braces[method](nestedAst(3000)), /exceeds max depth/);
      assert.throws(() => braces[method](nestedAst(101), { maxDepth: Infinity }), /exceeds max depth/);
      assert.throws(() => braces[method](nestedAst(101), { maxDepth: 10000 }), /exceeds max depth/);
    });
  }

  test(`${label}: depth boundary and ordinary glob semantics remain compatible`, () => {
    const atLimit = "(".repeat(100) + "a" + ")".repeat(100);
    assert.equal(braces.stringify(atLimit), atLimit);
    assert.equal(braces.compile(atLimit), atLimit);
    assert.deepEqual(braces.expand(atLimit), [atLimit]);
    assert.throws(() => braces.parse("{{a,b},c}", { maxDepth: 1 }), /exceeds max depth/);
    assert.doesNotThrow(() => braces.parse("{{a,b},c}", { maxDepth: 2 }));
    assert.deepEqual(braces.expand("file-{01..03}.{ts,tsx}"), [
      "file-01.ts", "file-01.tsx", "file-02.ts", "file-02.tsx", "file-03.ts", "file-03.tsx",
    ]);
    assert.deepEqual(braces.expand("a/{b,{c,d}}/e"), ["a/b/e", "a/c/e", "a/d/e"]);
    assert.equal(braces.stringify("a/{b,c}/d"), "a/{b,c}/d");
    assert.deepEqual(micromatch(["apps/cli/a.ts", "apps/docs/b.tsx", "README.md"], "apps/{cli,docs}/**/*.{ts,tsx}"), ["apps/cli/a.ts", "apps/docs/b.tsx"]);
  });
}

console.log(`Dependency patch checks: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
