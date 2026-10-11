---
"@kitsunekode/kunai": patch
---

chore(ci): close the zero-task, cache-replay, and golden-capture gate holes

Four gates used to be green without proving anything:

- `turbo --affected` on a non-package diff selected zero tasks and exited 0, so
  a docs/tools/workflow-only PR passed fmt/lint/typecheck/test having run
  nothing. `scripts/turbo-affected.sh` dry-runs the selection and falls back
  to the full task, and every `--affected` CI leg now goes through it.
- `typecheck` was the only blocking task still cacheable — a green run could
  be a Turbo replay. It is `cache: false` like lint/fmt/test now, and pre-push
  runs the same `bun run ci` chain (four blocking tasks plus the doc
  verifiers) instead of tests alone.
- Root-owned files (`.github/`, `scripts/`, root configs, `docs/`, `.docs/`,
  `.changeset/`) live outside every workspace, so `turbo run fmt:check` never
  saw them. A new `fmt:root`/`fmt:root:check` gate covers them, lint-staged
  formats the same set at commit time, and `.oxfmtrc.json` ignores the frozen
  `.archive/`/`.reference/` trees plus three files where the formatter cannot
  reach a fixed point.
- Committed terminal captures asserted on text nobody could regenerate.
  Every capture script now exports its fixture behind `import.meta.main`, a
  new `golden-captures-live.test.tsx` re-renders all 27 families at the three
  canonical widths and byte-diffs the committed files, and the three orphan
  families with no producer (`discover-sections`, `loading-shell.*`,
  `post-play.baseline`) are deleted rather than kept as vacuous coverage.

Verifier honesty fixes: `verify:build-pipeline` now deletes `dist/bin` before
the cache-restore leg and requires the binary back, not just "cache hit"
output; `verify:doc-coverage` routes on backticked code spans instead of bare
prose mentions; `verify:readme:commands` defaults to fixture mode + the host
binary so bare invocation does something meaningful; and the yt-dlp-gated
YouTube tests are visible `skipIf`s that actually run in CI (the binary is
installed in the test job, never invoked). `.release-candidate/` and `.delta/`
are gitignored.
