---
"@kitsunekode/kunai": patch
---

Make the CI "always" jobs stop passing without running, and three broken root
commands work.

**A pull request that changed no workspace package was typechecked, linted,
format-checked and tested by nothing.** Every always-job runs `--affected` on a
PR, and when a change touches no workspace package turbo selects zero tasks and
exits 0. Reproduced on a branch whose only commit edits `README.md`:

```
$ bunx turbo run typecheck --affected
 WARNING  No tasks were executed as part of this run.
$ echo $?
0
```

`install.sh`, `install.ps1`, `.github/**`, `docs/**`, `.docs/**` and `tools/**`
are all outside every workspace, so those PRs got four green jobs that ran
nothing. The jobs now fall back to the full graph when `--affected` selects
nothing.

The fallback asks the graph whether it selected any task rather than testing a
list of paths, because a path list is a declaration that decays — the next
top-level directory added to the repo would match nothing and silently opt out
of CI again.

**`bun run typecheck` can no longer be a cache replay.** It was the only task in
the blocking chain without `cache: false`, which is the one place AGENTS.md's
"a green gate can be a replay" hazard applied.

**`bun run verify:readme:commands` works when run bare.** The root script passed
no arguments to a script that requires three, so it exited 2 on every
invocation while looking like working coverage — and no doc showed the argument
form. The script now derives the version from the CLI manifest and the binary
from the host build path, and says what to run when the binary is absent.

**`.release-candidate/` and `.delta/` are gitignored.** 268 MB of npm tarballs
and bare clones were neither tracked nor ignored, so `git add -A` staged them.

**A stray NUL byte no longer makes a source file binary to grep.** The
separator in `offline-title-identity.ts` is now written as an escape, so the
file is readable by ripgrep and every lint pass that globs by extension. The
byte at runtime is unchanged.
