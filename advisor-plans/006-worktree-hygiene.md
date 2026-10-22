# Plan 006: Reclaim 61 git worktrees / ~31 GB of stale checkouts

> **Executor instructions**: Follow this plan step by step. This plan removes
> filesystem state — run every verification command and confirm the expected
> result before moving on. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git worktree list | wc -l` — was **61** on
> `faf1afd22`, 2026-10-10. If the count is already small (<10), the maintainer
> handled it; mark this plan DONE and stop.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MEDIUM (irreversible if a worktree holds uncommitted work — that's
  why every removal is gated, and nothing is force-removed)
- **Depends on**: none
- **Category**: dx / hygiene
- **Planned at**: commit `faf1afd22`, 2026-10-10

## Why this matters

`git worktree list` shows **61 registered worktrees** (~31 GB under
`.worktrees/` plus 9 under `.claude/worktrees/`), most pinned to audit/fix
branches that are already merged or superseded. Concrete costs:

- Every worktree carries its own `node_modules` → ~500 MB each; disk pressure
  is real (31 GB measured with `du -sh .worktrees`).
- Stale worktrees keep stale `HEAD`s alive: greps and editor searches hit old
  copies of source files (this audit initially hit `.claude/worktrees/*`
  copies of `.docs/repo-infrastructure.md` before the real one).
- Each checkout's `node_modules/.bun` store is per-tree; pruning worktrees
  wholesale is also how the root checkout's store ended up with dangling
  symlinks (see "Related" below).

## Current state

- `git worktree list | wc -l` → `61`
- `du -sh .worktrees` → `31G`
- Worktrees live in two places: `.worktrees/<name>` and
  `.claude/worktrees/<name>`. Both are registered in the same git admin dir,
  so `git worktree remove` handles both.
- Many branches backing them are merged (e.g. `fix/audit-batch1-high-leverage`
  = merged PR #572) or are detached HEAD probes (`mainprobe`, `docs-polish`,
  `audit-verify-20261008`, `current-followups-20261007`,
  `dependency-advisories-20261007`).

## Commands

| Purpose                         | Command                                                  | Expected            |
| ------------------------------- | -------------------------------------------------------- | ------------------- |
| Inventory                       | `git worktree list`                                      | 61 rows at baseline |
| Merged branches                 | `git branch --merged main`                               | branch list         |
| Open PRs                        | `gh pr list --state open --limit 100 --json headRefName` | branch→PR map       |
| Uncommitted state in a worktree | `git -C <path> status --porcelain`                       | empty = clean       |
| Disk before/after               | `du -sh .worktrees .claude/worktrees`                    | 31G → small         |

## Steps

### Step 1: Build the removal table

For every worktree except the root checkout
(`/home/kitsunekode/Projects/hacking/kitsunesnipe`), record:

1. `git -C <path> status --porcelain` — non-empty means **keep** (uncommitted
   work may exist; flag it for the maintainer).
2. Whether its branch has an **open PR** (`gh pr list`). Open PR → **keep**.
3. Whether its branch is merged into `main` (`git branch --merged main`)
   or the worktree is detached → removal candidates.

Output three buckets: `remove`, `keep (open PR)`, `ask (dirty or unmerged)`.

### Step 2: Remove the safe bucket

Only for worktrees that are clean AND (merged OR detached):

```sh
git worktree remove <path>
```

Never use `--force`. If `git worktree remove` refuses, move it to the
`ask` bucket.

### Step 3: Prune admin records and re-measure

```sh
git worktree prune   # clears admin entries whose directories are already gone
git worktree list | wc -l
du -sh .worktrees .claude/worktrees
```

### Step 4: Report

Report the three buckets with counts, and the disk reclaimed. The `ask`
bucket goes back to the maintainer as a list — deleting unmerged work is a
human decision, not an agent one.

## Done criteria

- [ ] Every remaining worktree is either the root checkout, has an open PR,
      or was explicitly kept by the maintainer
- [ ] `git worktree list` output included in report
- [ ] Zero worktrees were force-removed
- [ ] `bun run typecheck` still exits 0 in the root checkout afterwards
      (worktree removal must not touch root `node_modules`)

## STOP conditions

- Any worktree in the `remove` bucket turns out to host an unpushed branch
  tip (`git log <branch> --not --remotes` non-empty) → move it to `ask`.
- `git worktree remove` errors in a way not covered above → stop, report.

## Maintenance notes

- Recurrence prevention: the `.claude/worktrees/` and `.worktrees/` patterns
  come from agent sessions. Consider a standing rule — agent-created
  worktrees get removed when their PR merges. That is a workflow decision,
  not enforced anywhere today.
- Related finding (this audit): the root checkout's `node_modules/.bun`
  store had dangling symlinks for `turbo@2.11.5` and `typescript@7.0.2`,
  making every `bun run <gate>` fail with `turbo: command not found` until a
  `bun install --frozen-lockfile` repaired the links. If gate commands fail
  with ENOENT-style "command not found" for a tool that is in
  `package.json`, suspect this first — it's cheap to check
  (`ls -la node_modules/.bin/` looking for dangling links).
