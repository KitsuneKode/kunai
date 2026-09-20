# Plan 057: Close the command-reachability residue from #91

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/domain/session/command-registry.ts apps/cli/src/app-shell/workflows/shell-workflows.ts apps/cli/test/unit/app-shell/command-registry.coverage.test.ts`
> Mismatch → re-run the reachability analysis before changing anything; the registry may have been reshaped.

Closes the residue of #91. **Already landed since the issue was filed:** the
`command-registry.coverage.test.ts` reachability test (#268/#282) and
`up-next`/`playlist-add`/`queue-season` in `COMMAND_CONTEXTS.activePlayback`
(command-registry.ts:155-160). What remains is below — verify each claim
against the tree; #91 was filed 2026-08-23 and parts may have landed since.

## Status

- **Priority:** P3
- **Effort:** S
- **Risk:** LOW
- **Depends on:** none
- **Category:** bug / UX coherence
- **Planned at:** `51f19b633`, 2026-09-19

## Current state (verified)

- `handleQueueSeason` (`shell-workflows.ts:3066-3112`) reads
  `state.currentTitle` + `state.currentEpisode` — **playback-context only**;
  in browse there is no `currentEpisode`, so the command bails with "Select a
  series episode…". It's registered in `activePlayback` + `postPlayback` but
  not browse — surfacing it in browse needs a row-carrying variant.
- `/image-pane` **has** enablement logic (`command-registry.ts:1129-1142`:
  gated on `layout.details.imageSupported` + `!tooSmall`) — the issue's
  "type references only" claim needs re-verification: check whether a handler
  exists in `shell-workflows` dispatch (search `image-pane` there). If it
  enables but does nothing, that's a silent no-op — worse than removal.
- `/favorites` has a real handler (`shell-workflows.ts:881` → `handleFavorites`,
  "No favorites yet." output at :2449) — not dead, but ADR-0001-retired as a
  concept (Watchlist/Bookmarks supersede it). Removal is a product call, not
  a code call.

## Commands

| Purpose       | Command                                                                                  | Expected |
| ------------- | ---------------------------------------------------------------------------------------- | -------- |
| Unit tests    | `bun run --cwd apps/cli test:unit`                                                       | all pass |
| Coverage test | `bun run --cwd apps/cli test:file test/unit/app-shell/command-registry.coverage.test.ts` | all pass |
| Typecheck     | `bun run typecheck --force`                                                              | exit 0   |

## Scope

**In scope:**

- `command-registry.ts`, `shell-workflows.ts`, browse-surface command sets
  (`SEARCH_BROWSE_COMMAND_IDS` or its current equivalent)
- `command-registry.coverage.test.ts` — extend if the residue adds surface
- `.changeset/` — patch if any user-visible command appears/disappears

**Out of scope:**

- Re-litigating the deliberate-hidden set (`/sync-connect-*`, `/sync-disconnect`, `/clear-history`, `/random`, `/surprise`, `/favorites` per ADR-0001) — the issue already triaged them as correct.
- The coverage test itself — it exists; only extend it if a new surface/command class is added.

## Steps

### Step 1: Verify the residue is real

For each claim, confirm against current code:

1. `/queue-season` unreachable in browse — check which context list covers the
   browse surface today.
2. `/image-pane` — does a dispatch handler exist (grep `case "image-pane"` /
   handler map in shell-workflows)? Dead command → remove; working → stays.
3. `/favorites` — working handler exists; the only question is whether to
   retire it per ADR-0001. **Escalate, don't decide:** leave `/favorites`
   as-is in this plan unless the operator says remove — removing a working
   command is a product call.

**Verify:** notes on each verdict in the PR body.

### Step 2: `/queue-season` in browse (if still absent)

Add a browse-surface variant. The issue's constraints: match by **id**, not
cursor position (browse cursor is local Ink state); series-only (movies have
no seasons); needs the season list from the selected row's title context.

Implementation shape: the browse variant dispatches a shell action carrying
the selected `SearchResult`/title id; the handler resolves episodes for that
title (reuse `resolveSeasonEpisodesForQueue` — it takes `(container, title,
currentEpisode)`; for browse, synthesize `currentEpisode` as S1E1 or the
title's first unwatched, and queue "the whole season" or "from episode" —
pick the semantic that matches the command's name, document the choice).

If `title.type !== "series"` on the selected row → the existing honest
feedback path (`SET_PLAYBACK_FEEDBACK` note), never silent.

**Verify:** coverage test + a new browse-context test asserting
`/queue-season` resolves enabled on a series row and disabled-with-reason on
a movie row.

### Step 3: `/image-pane` verdict

Whatever Step 1 found: handler missing → remove the command id + its
enablement case + registry entry (dead code); handler present → nothing to
do, note it in the PR. Do not leave a third state.

### Step 4: Coverage + changeset

Extend `command-registry.coverage.test.ts` only if a new surface/context was
added. Changeset if commands appeared or disappeared.

## Test plan

- Browse-context `/queue-season`: enabled on series, reason on movie, queue
  receives rows keyed by title id (not index).
- `/image-pane` post-change: either absent everywhere or enabled-with-handler —
  assert one of the two states explicitly.
- Existing coverage test keeps passing (all commands reachable).

## Done criteria

- [ ] `/queue-season` reachable in browse for series rows, or documented why not
- [ ] `/image-pane` is either fully wired or fully removed — no middle state
- [ ] `/favorites` decision recorded in PR (default: keep, ADR-0001 governs)
- [ ] `bun run test --force` + `typecheck --force` green

## STOP conditions

- Browse has no access to season episode lists without a resolve round-trip
  the UX can't afford — report; the right fix may be "queue whole show"
  semantics instead.
- `/image-pane` removal orphans a keybinding — grep keybindings first; a
  removal must be total (command, enablement case, keybinding, help entries).

## Maintenance notes

- The coverage test is the guard; when adding commands, the red-run rule from
  the gate-trust work (plan 051 / issue #117) applies — show it fails on an
  unreachable command.
- If `queue-season` browse lands, check post-play and picker surfaces for
  consistency per the "entry points" house rule.
