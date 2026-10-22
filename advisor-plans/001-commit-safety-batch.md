# Plan 001: Make the current working tree safe to commit (roadmap truth, doc gate, stray artifacts)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- .plans/roadmap.md .docs/research/audit-4-2026-10-07.md .gitignore packages/storage apps/cli/test/unit/architecture`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs / dx
- **Planned at**: commit `faf1afd22`, 2026-10-09

## Why this matters

The branch's dirty working tree currently contains three things that quietly
break promises if committed: (1) `.plans/roadmap.md` in the working tree
**reverts three LANDED plan rows back to TODO** (their plan files live only in
`.archive/`, where "no authority" applies) and reverts text for a cron schedule
that already ships; (2) the untracked `.docs/research/audit-4-2026-10-07.md`
has no YAML frontmatter, which makes `bun run verify:doc-frontmatter` — part of
`bun run ci` — **fail on every local run** while staying green in CI (the file
is untracked there), training contributors to ignore the gate; (3) 37 MB of
stray SQLite files sit in `packages/storage/undefined/`, and their `-wal`/`-shm`
sidecars (plus generated VHS GIFs) are **not gitignored**, so `git add -A`
can stage runtime database state. This plan fixes all three, plus adds a small
guard so a literal `undefined/` path segment can never silently reappear.

## Current state

- `.plans/roadmap.md` — the repo's only plan index. Working-tree edits (uncommitted)
  both ADD good content (new "Codebase audit remediation — 2026-09-30" and
  "Agent execution packets — 2026-10-01" sections) and REGRESS four rows.
  Repo rule from `AGENTS.md`: "`bun run verify:doc-paths` checks every backticked
  path and relative link in `AGENTS.md` and `.docs/`, plus the mechanical half
  of the roadmap index: every `.plans/*.md` must be linked, and a LANDED row
  must point into `.archive/`."
- The four regressed hunks, exactly as `git diff .plans/roadmap.md` shows them
  (`-` = committed HEAD truth, `+` = current working tree, i.e. the regression):

```diff
-Last updated: 2026-10-02
+Last updated: 2026-10-01

-| Analytics day boundary   | Task 8 only: schedule is now `0 19 * * *`; prove the IST clock is live in prod before merge, then verify the first run | ...
+| Analytics day boundary   | Task 8 only, after the cutover: prove the IST clock is live, then move the snapshot cron to `0 19 * * *`  | ...

-| [064](../.archive/plans/064-analytics-day-table-order-and-paging.md)  | —     | none — day-by-day table is newest-first with chunked reveal                                                               | LANDED                             |
+| [064](../.archive/plans/064-analytics-day-table-order-and-paging.md)  | —     | Day-by-day table: newest-first + chunked reveal (bounded at 180 rows)                                                     | TODO                               |

-| [066](../.archive/plans/066-analytics-cross-links-and-staleness.md)   | —     | none — release links, `#day-by-day` anchor, and the 48h stale badge all landed                                            | LANDED                             |
+| [066](../.archive/plans/066-analytics-cross-links-and-staleness.md)   | —     | Version rows → release pages; window tile → `#day-by-day`; stale badge                                                    | TODO                               |

-| [067](../.archive/plans/067-chart-table-highlight-sync.md)            | —     | none — chart hover reveals and scrolls the matching table row                                                             | LANDED                             |
+| [067](../.archive/plans/067-chart-table-highlight-sync.md)            | —     | Chart hover → table row highlight/scroll (after 064)                                                                      | TODO                               |
```

Facts confirming HEAD (the `-` side) is correct: `ls .plans/064*` matches
nothing (plan files are archive-only), and the cron schedule ships at
`apps/analytics-ingest/vercel.json:24` → `"schedule": "0 19 * * *"`.

- `.docs/research/audit-4-2026-10-07.md` — starts directly with `# Audit 4 — ...`
  (no frontmatter, no L3 banner). The compliant exemplar is
  `.docs/research/audit-3-handoff.md:1-7`:

```markdown
---
status: current
lastReviewed: "2026-09-26"
---

# Audit 3 — Handoff for fix agents

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.
```

Live failure (verified 2026-10-09): `bun run verify:doc-frontmatter` exits 1 with
`\.docs/research/audit-4-2026-10-07.md — no YAML frontmatter` and
`Every live .docs doc needs frontmatter (status + lastReviewed) and the L3 banner under its H1.`

- `.gitignore:46-48` — the databases section:

```
# databases
*.db
*.sqlite
*.sqlite3
```

`git check-ignore` confirms `*.sqlite` files are ignored but
`apps/cli/test/vhs/golden/command-palette.gif` is **not** ignored (exit 1),
and `git status --porcelain` shows `?? packages/storage/undefined/` and
`?? apps/cli/test/vhs/golden/`.

- `packages/storage/undefined/` — contains `cache.sqlite`, `data.sqlite`,
  `hist.sqlite` (37.9 MB) + `-shm`/`-shm` sidecars. Verified producer: an
  ad-hoc perf snippet from a previous agent session ran
  `SANDBOX=/tmp/... && ... bun -e 'const dir = process.env.SANDBOX; const db = new Database(dir + "/hist.sqlite", ...)'`
  where `SANDBOX=` was a **standalone shell assignment, never exported** — so
  `dir` was `undefined` and the string concatenation resolved relative to cwd.
  `hist.sqlite` has `idx_probe`/`idx_probe2` indexes that exist nowhere in the
  repo and **no `__kunai_migrations` table** (not a real Kunai database).
  `data.sqlite`/`cache.sqlite` producers were not individually confirmed — see
  step 3's verification before removing anything.
- `apps/cli/test/unit/architecture/` — house home for repo-scanning guard tests
  (e.g. `boundary-imports.test.ts`, `contract-conformance.test.ts`). New guards
  go here, following that pattern.
- `apps/cli/test/vhs/` — four `.tape` sources are tracked; three generated GIFs
  in `golden/` are untracked and unignored. Scripts: `test:vhs:*` in
  `apps/cli/package.json:84-88`.

## Commands you will need

| Purpose                | Command                                                        | Expected on success                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doc path gate          | `bun run verify:doc-paths`                                     | exit 0                                                                                                                                                                                                           |
| Doc frontmatter gate   | `bun run verify:doc-frontmatter`                               | exit 0 (currently exits 1 — that's the bug)                                                                                                                                                                      |
| Typecheck              | `bun run typecheck`                                            | exit 0                                                                                                                                                                                                           |
| Lint                   | `bun run lint`                                                 | exit 0 (17 pre-existing warnings are the baseline)                                                                                                                                                               |
| CLI unit tests         | `bunx turbo run test:unit --filter=@kitsunekode/kunai --force` | exit 1 with EXACTLY one known failure: `design color resolution > downgrades accent for truecolor terminals` (caused by the uncommitted WIP `packages/design/src/tokens.ts` re-theme — NOT yours, do not fix it) |
| Format only your files | `bunx oxfmt --write <files you changed>`                       | reformats them if needed                                                                                                                                                                                         |

**Do NOT run repo-wide `bun run fmt`** — it would touch the maintainer's
uncommitted WIP (`packages/design/src/tokens.ts`, `.plans/*`), which is out of
scope for you.

## Scope

**In scope** (the only files you should modify/create):

- `.plans/roadmap.md` (four row/date restorations only)
- `.docs/research/audit-4-2026-10-07.md` (add frontmatter + L3 banner only)
- `.gitignore` (database sidecar + VHS golden patterns)
- `packages/storage/undefined/` (moved out of the repo, after verification)
- `apps/cli/test/unit/architecture/no-stray-workspace-dirs.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):

- `packages/design/src/tokens.ts` — maintainer's WIP re-theme.
- The untracked `.plans/2026-*.md` files — whether they should be (re)tracked
  is a maintainer decision (commit `825e89cd6` "untrack accidentally-swept plan
  docs" suggests deliberate untracking). Do not `git add` or delete them. See
  STOP condition 4 — you will flag this instead.
- Any content changes to the new roadmap sections (audit remediation /
  execution packets) — keep them exactly as they are on disk.
- `.docs/research/audit-3-handoff.md` — already compliant; exemplar only.

## Git workflow

- Branch: `advisor/001-commit-safety-batch` (house convention — see
  `.plans/roadmap.md` "048–058 are implemented on `advisor/NNN-*` worktree branches").
- Commit style matches `git log`: conventional, scoped — e.g.
  `fix(plans): restore landed roadmap rows and shipped cron text` and
  `fix(gate): frontmatter for audit-4 doc + ignore db sidecars and vhs goldens`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Restore the four regressed roadmap hunks

In `.plans/roadmap.md`, apply exactly these four restorations (keep every
other working-tree change, especially the two new sections at the bottom):

1. `Last updated: 2026-10-01` → `Last updated: 2026-10-02`
2. Analytics day boundary "Remaining" cell → the exact HEAD text from the
   diff above, restored verbatim:
   ``Task 8 only: schedule is now `0 19 * * *`; prove the IST clock is live in prod before merge, then verify the first run``
3. Plan 064 row → Remaining `none — day-by-day table is newest-first with chunked reveal`, Status `LANDED`
4. Plan 066 row → Remaining `none — release links, `#day-by-day` anchor, and the 48h stale badge all landed`, Status `LANDED`
5. Plan 067 row → Remaining `none — chart hover reveals and scrolls the matching table row`, Status `LANDED`

The fastest safe method: `git diff .plans/roadmap.md` and revert ONLY the
hunks shown in "Current state" above — then re-read the whole file once to
confirm the new sections survived.

**Verify**: `git diff .plans/roadmap.md | grep -c '^-[^-]'` → only deletions
of your restored text remain expected; more usefully:
`git diff .plans/roadmap.md` shows no `-` lines for `Last updated`, the
analytics row, or rows 064/066/067 (i.e. the working tree now matches HEAD
there), and shows only `+` additions of the new sections.

### Step 2: Add frontmatter + L3 banner to the audit-4 doc

In `.docs/research/audit-4-2026-10-07.md`, make the top of the file match the
audit-3 exemplar shape: insert before `# Audit 4 — ...`:

```markdown
---
status: current
lastReviewed: "2026-10-09"
---
```

and directly under the H1, insert:

```markdown
> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.
```

Do not change any other content.

**Verify**: `bun run verify:doc-frontmatter` → exit 0, `0 problem(s)`.

### Step 3: Verify, then move the stray `undefined/` directory out of the repo

First establish the files are not real user profile data:

**Verify**: `bun -e 'const {Database}=require("bun:sqlite"); for (const f of ["cache","data","hist"]) { const db=new Database(`packages/storage/undefined/${f}.sqlite`,{readonly:true}); const t=db.query("SELECT name FROM sqlite_master WHERE type=\"table\"").all().map(r=>r.name); console.log(f, JSON.stringify(t)); }'`
→ Expect tables like `history_progress`, `idx_probe`-style leftovers, and
NOT a `__kunai_migrations` table. If **any** of the three databases contains
`__kunai_migrations` AND row counts that look like real history (thousands of
rows in history-like tables), **STOP** — that would be real profile data and
the maintainer must decide.

If verification passes (synthetic/stray data):

```
mv packages/storage/undefined /tmp/kunai-undefined-stray-backup
```

(Move — not `rm -rf` — so nothing is destroyed; note the backup path in your
report.)

**Verify**: `test ! -e packages/storage/undefined && echo moved` → `moved`.

### Step 4: Extend `.gitignore`

In the `# databases` section (after `*.sqlite3`), add:

```
*.db-wal
*.db-shm
*.sqlite-wal
*.sqlite-shm
*.sqlite3-wal
*.sqlite3-shm
```

And add a new section (e.g. after `# databases`, before `# code coverage`):

```
# generated VHS golden captures (regenerate with `bun run test:vhs:all`)
apps/cli/test/vhs/golden/
```

**Verify**: `git check-ignore packages/storage/foo.sqlite-wal apps/cli/test/vhs/golden/x.gif` →
prints both paths (exit 0); `git status --porcelain` no longer lists
`packages/storage/undefined/` or `apps/cli/test/vhs/golden/`.

### Step 5: Add the stray-directory guard test

Create `apps/cli/test/unit/architecture/no-stray-workspace-dirs.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A literal `undefined` path segment means some code interpolated an
// undefined value into a directory path and wrote files relative to the repo
// (instance: packages/storage/undefined/*.sqlite, 37 MB, from an unexported
// shell var + string concat). This test is the tripwire.
const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const SKIP = new Set(["node_modules", "dist", ".turbo"]);

function findStrayUndefined(dir: string, out: string[], depth = 10): void {
  if (depth <= 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (entry === "undefined") {
      out.push(full);
      continue;
    }
    try {
      if (statSync(full).isDirectory()) findStrayUndefined(full, out, depth - 1);
    } catch {
      // race with concurrent test cleanup — skip
    }
  }
}

describe("workspace hygiene", () => {
  test("no directory literally named `undefined` exists under apps/ or packages/", () => {
    const strays: string[] = [];
    for (const root of ["apps", "packages"]) {
      findStrayUndefined(join(repoRoot, root), strays);
    }
    expect(strays).toEqual([]);
  });
});
```

Adjust nothing else; if the repo's lint rules complain about the shape,
reformat with `bunx oxfmt --write` on the file and re-run lint.

**Verify**: `bun run --cwd apps/cli test:file test/unit/architecture/no-stray-workspace-dirs.test.ts` → passes.

## Test plan

- The new guard test above is the only new test. Cases covered: any
  `undefined` directory anywhere under `apps/` or `packages/` (depth-limited,
  skipping dot-dirs and `node_modules`/`dist`/`.turbo`).
- Pattern to follow: existing architecture guards in
  `apps/cli/test/unit/architecture/` (they are plain `bun:test` files).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run verify:doc-frontmatter` exits 0
- [ ] `bun run verify:doc-paths` exits 0
- [ ] `git diff .plans/roadmap.md` contains no working-tree reverts of the
      `Last updated` line, the analytics-day-boundary row, or rows 064/066/067
      (those four match HEAD; new sections still present)
- [ ] `test ! -e packages/storage/undefined` → true; backup path reported
- [ ] `git check-ignore apps/cli/test/vhs/golden/x.gif` exits 0
- [ ] `bun run typecheck` exits 0
- [ ] `bun run lint` exits 0
- [ ] New guard test passes; `bunx turbo run test:unit --filter=@kitsunekode/kunai --force`
      shows no NEW failures beyond the known WIP failure
      (`design color resolution > downgrades accent for truecolor terminals`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the three SQLite databases under `packages/storage/undefined/` looks
  like real user data (has `__kunai_migrations` and non-trivial history rows).
- The roadmap file on disk no longer matches the four regression hunks shown
  here (it has drifted since `faf1afd22`).
- You find that `.plans/2026-*.md` files referenced by the roadmap's new
  sections are untracked (`git status` shows `??`). Do NOT git-add them —
  report that the committed roadmap would reference untracked files and let
  the maintainer decide (this interacts with commit `825e89cd6`).
- `bun run verify:doc-paths` fails AFTER your roadmap edits.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The roadmap's LANDED rows must point into `.archive/` — that is enforced
  mechanically by `bun run verify:doc-paths`. If you later land plans 064–067
  style work, update the row and move the plan file in the same change set.
- `apps/cli/test/vhs/golden/` is now ignored because the GIFs are regenerable
  (`bun run test:vhs:all`). If `.plans/poster-protocol-release-smokes.md`
  eventually wants committed golden snapshots, that plan must revisit this
  ignore line deliberately.
- The stray-directory guard trips if ANY test or script ever creates a path
  segment named `undefined` — that is the point; the fix is in the producing
  code, not in the guard.
- A reviewer should confirm the roadmap keeps its two new sections verbatim and
  that no other rows changed.
