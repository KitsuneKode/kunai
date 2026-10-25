# Maintained dependency patches

## braces 3.0.3: CVE-2026-93687

`braces@3.0.3.patch` bounds parser and recursive AST processing at 100 nested
containers. A caller may request a stricter `maxDepth`, but cannot raise this
ceiling. Direct AST arguments to compile, expand and stringify receive the
same protection. Rejected strings raise a bounded SyntaxError; rejected ASTs
raise a bounded RangeError. Callers must handle validation errors just as they
handle the existing input-length and expansion limits.

Source: [upstream PR 72](https://github.com/micromatch/braces/pull/72), revision
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, by FSDevelop, under the package's
MIT license. This carries the five runtime-file changes, with one deliberate
difference: stringify retains its existing empty parent argument so this
security patch does not change `escapeInvalid` behavior. Upstream proposal
tests and documentation are not installed by the patch.

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) listed
no patched release on October 3, 2026. This is a locally maintained mitigation,
not an official upstream release. `bun audit` will continue to flag the installed
3.0.3 version; do not suppress the advisory or describe the audit as clean.

The root `patchedDependencies` and lockfile bind the patch. Bun applies it on
`bun install --frozen-lockfile`. Every shared CI setup verifies behavior through
the actual Changesets config/git and shadcn glob dependency paths:

Patch contents are included in the Bun store cache key and Turbo's global task
hash, so editing an existing patch cannot reuse a build made without that change.

```sh
bun run verify:dependency-patches
node scripts/verify-dependency-patches.mjs
```

Checks cover deeply nested braces, parentheses and mixed patterns below the
existing length ceiling; direct ASTs; attempts to raise the ceiling; the allowed
boundary; and ordinary glob/range semantics. All 15 checks failed against the
unpatched installation and pass with the patch. Keep the verifier when updating
dependencies. When upstream publishes a reviewed fix, remove the patch binding,
regenerate the lockfile, and verify these contracts before removing the patch.
