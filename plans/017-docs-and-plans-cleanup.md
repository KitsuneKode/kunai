# Plan 017: Cut the doc/plan surface to a trustworthy core

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done. This plan edits docs only —
> no source or test changes.
>
> **Drift check (run first)**: `ls .docs .plans | head` and re-confirm the stale
> examples below still exist before editing.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

The doc surface is itself debt. `.docs/architecture.md` points at files that no longer exist (`config.ts`, `scraper.ts`, `search-routing.ts`) and there are four competing architecture docs (`architecture.md`, `architecture-v2.md`, `KUNAI_ARCHITECTURE.md`, `ux-architecture.md`). `.plans/` holds 123 files — ~39 already marked complete/shipped/superseded — flat in one directory, adjudicated by an 80KB `plan-implementation-truth.md` that itself references removed files. For a repo whose workflow is "agents execute the plans," the surface an agent must read to know current truth exceeds any practical context budget and contradicts itself. Trimming to one canonical architecture doc + an archived plans folder + a short entry point makes the codebase self-explanatory and stops agents (and humans) from starting from wrong truth.

## Current state

- Actively-wrong paths in `.docs/architecture.md`: references to `apps/cli/src/config.ts`, `apps/cli/src/scraper.ts`, `apps/cli/src/app/search-routing.ts` — none exist (verified). (`apps/cli/index.ts` references are fine — that wrapper exists.)
- Four architecture docs in `.docs/`: `architecture.md`, `architecture-v2.md`, `KUNAI_ARCHITECTURE.md`, `ux-architecture.md`.
- `.plans/`: 123 `.md` files; ~39 with a `Status:` of complete/shipped/implemented/superseded (find them: `grep -rl 'Status.*\(omplete\|hipped\|mplemented\|uperseded\)' .plans/*.md`).
- `.plans/plan-implementation-truth.md` (~80KB) exists to adjudicate plan-vs-code drift and itself cites removed files.
- Entry point: `CLAUDE.md` is a symlink to `AGENTS.md` (164 lines) which links out to the whole surface.

Repo conventions: `.plans/roadmap.md` is meant to be the short active index (it says so); `TODO.md` is intentionally thin and points at the trackers. Conventional commits (`docs(...)`).

## Commands you will need

| Purpose                    | Command                                                                     | Expected                                  |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Find dead paths            | `grep -rn 'config.ts\|scraper.ts\|search-routing' .docs/architecture.md`    | the stale refs                            |
| Find shipped plans         | `grep -rl 'Status.*\(omplete\|hipped\|mplemented\|uperseded\)' .plans/*.md` | ~39 files                                 |
| Verify a path exists       | `ls apps/cli/src/<path>`                                                    | exists / not                              |
| Docs build (if applicable) | `bun run build:docs`                                                        | exit 0 (only if `.docs` feeds it — check) |

## Scope

**In scope**:

- `.docs/architecture.md`, `.docs/architecture-v2.md`, `.docs/KUNAI_ARCHITECTURE.md` (consolidate to one canonical)
- `.plans/` → create `.plans/archive/` and move shipped/superseded plans there
- `.plans/roadmap.md` (confirm it's the single active index)
- `AGENTS.md` (tighten the entry point)
- `.plans/plan-implementation-truth.md` (retire or slim once the active set is small)
- `CLAUDE.md` links list (it enumerates many `.plans/*` — prune to active)

**Out of scope**:

- Any source or test file.
- Deleting plan history (archive, don't delete — git keeps it anyway, but keep the files for reference).
- The `.docs/*` guides that are accurate and referenced from CLAUDE.md (only touch the architecture-doc duplication and dead paths).

## Git workflow

- Branch: `advisor/017-docs-cleanup`
- Commits: `docs(architecture): consolidate to one canonical doc and fix dead paths`, `docs(plans): archive shipped and superseded plans`, `docs(agents): tighten the entry point`.

## Steps

### Step 1: Fix or fold the dead architecture-doc paths

Pick ONE canonical architecture doc (likely `architecture-v2.md` since the `-v2` implies supersession — confirm by content and git recency). In it, ensure every file path resolves (`config.ts`→ wherever config now lives, e.g. `services/persistence/ConfigService.ts`; `scraper.ts`→ `packages/providers/*/direct.ts` + `container.ts`; `search-routing.ts`→ `services/search/*`). Reduce the other architecture docs to a one-line pointer to the canonical one, or delete them if fully redundant. Update any CLAUDE.md/AGENTS.md link that points at a deleted/merged doc.

**Verify**: `grep -rn 'config.ts\|scraper.ts\|search-routing' .docs/` returns only correct/current references; every path referenced in the canonical doc passes `ls`.

### Step 2: Archive shipped/superseded plans

Create `.plans/archive/`. For each file whose `Status:` is complete/shipped/implemented/superseded (from the grep), move it into `.plans/archive/`. Leave genuinely active plans (and `roadmap.md`, `plan-implementation-truth.md` for now) in `.plans/`.

**Verify**: `.plans/` (excluding `archive/`) contains only active plans + roadmap + the truth index; `ls .plans/archive | wc -l` ≈ the count of shipped plans found.

### Step 3: Re-point references to moved plans

`grep -rn '.plans/' CLAUDE.md AGENTS.md .docs/*.md` and fix any link that now points into `archive/` or is stale. Prune the long `.plans/*` enumeration in CLAUDE.md down to the active set.

**Verify**: no CLAUDE.md/AGENTS.md link resolves to a non-existent path (`grep -o '\.plans/[a-z0-9-]*\.md' CLAUDE.md | while read p; do test -f "$p" || echo "MISSING: $p"; done` → no output).

### Step 4: Slim or retire the truth index

Once the active plan set is small, `plan-implementation-truth.md`'s job (adjudicating drift across 123 files) mostly disappears. Either (a) trim it to only entries about _active_ plans and fix its references to removed files, or (b) if the active set is now small enough that "read roadmap.md + the code" suffices, replace its body with a short note pointing there and move the old content into `archive/`. Fix any file path in it that fails `ls`.

**Verify**: every `apps/cli/...` path cited in the (remaining) truth index passes `ls`, or the file is archived.

### Step 5: Tighten the entry point

In `AGENTS.md` (which `CLAUDE.md` symlinks), make the "read this first" path short and canonical: roadmap + the one architecture doc + the code, with everything else clearly secondary. Keep it accurate to what now exists.

**Verify**: read `AGENTS.md` top-to-bottom — every link resolves (`grep -o '[A-Za-z0-9._/-]*\.md' AGENTS.md | while read p; do test -f "$p" || echo "MISSING: $p"; done` → no output).

## Done criteria

- [ ] One canonical architecture doc; the others are pointers or gone; all its paths resolve
- [ ] `grep -rn 'config.ts\|scraper.ts\|search-routing' .docs/` shows no dead references
- [ ] Shipped/superseded plans live in `.plans/archive/`; active set is small
- [ ] No CLAUDE.md/AGENTS.md/.docs link points at a missing file (grep checks above return nothing)
- [ ] `plan-implementation-truth.md` slimmed/retired with no dead paths
- [ ] Only docs changed (`git status` shows no source/test edits); `plans/README.md` row updated

## STOP conditions

- Two architecture docs each contain unique, still-accurate content that can't be cleanly merged — merge what you can and report the residual rather than deleting information.
- A plan you'd archive is actually active (its `Status:` line is stale-in-the-other-direction) — verify against the code before moving; when unsure, leave it active.
- `.docs/` feeds a published docs site (`apps/docs`) and moving files breaks its build — check `bun run build:docs` and keep referenced files in place.

## Maintenance notes

- Going forward: one architecture doc, `roadmap.md` as the only active plan index, shipped plans archived on completion. This is the discipline that keeps the surface trustworthy.
- Reviewer: spot-check five random paths in the canonical architecture doc and five links in AGENTS.md.
- Note: this repo's own `.plans/` is separate from the advisor `plans/` directory these plans live in — don't conflate them.
