# Dependency verification

No Bun dependency patches are active. The former `braces@3.0.3` patch and
its consumer verifier were archived under
`.archive/dependency-patches/2026-10-28-braces/` after the last shadcn CLI/glob
consumer was removed. Changesets 3 already uses picomatch.

`bun run verify:dependency-patches` retains a fail-closed graph regression:
the removed generator, deepmerge and braces/micromatch packages must remain
absent from the lockfile, and installed Changesets manifests must continue to
declare picomatch instead of micromatch/braces. Reintroducing these packages
requires a fresh security and consumer review; stale hoisted packages do not
count as declared dependencies. The registry audit remains unsuppressed.

The docs retain the generated component source, `components.json` and the
licensed stylesheet under `apps/docs/app/styles/vendor/`; their build no longer
installs a component-generation CLI.

```sh
bun run verify:dependency-patches
node scripts/verify-dependency-patches.mjs
```
