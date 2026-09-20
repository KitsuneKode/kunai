# Plan 054: Resolve anime seasons as catalog entries, not title ordinals

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- packages/types/src/index.ts apps/cli/src/domain/catalog/ packages/providers/src/`
> This is a contract plan — if `TitleIdentity` or provider resolve input changed shape, re-read both before writing.

Closes #266.

## Status

- **Priority:** P2
- **Effort:** L — contract change across `@kunai/types` and every anime provider adapter
- **Risk:** HIGH if heuristics sneak in — the issue's core constraint is "resolving the wrong title silently is worse than not resolving at all" (`season-routing.ts` already states this)
- **Depends on:** none blocking; complements #178's provider-native episode identity (landed)
- **Category:** architecture / correctness
- **Planned at:** `51f19b633`, 2026-09-19
- **Nature:** design-then-implement — Steps 1–2 produce the contract; steps 3+ land it per provider

## Why this matters

Kunai asks providers for "season N of <title>" and each adapter guesses which
of its entries that is. For catalogs that name seasons after story arcs
(AniDB's `Mugen Train Arc` / `Entertainment District Arc` / `Swordsmith
Village Arc`…), no text rule maps arc→ordinal — and AniDB, AniList, and TMDB
genuinely disagree on the numbering. Today it fails closed (correct), meaning
Demon Slayer S2 is unplayable through AniDB. Each adapter re-derives the same
wrong-able guess from a title string that cannot carry the answer.

## Current state

- `TitleIdentity` (`packages/types/src/index.ts:161-171`):
  ```ts
  export interface TitleIdentity {
    readonly id: string;
    readonly kind: MediaKind;
    readonly title: string;
    readonly year?: number;
    readonly anilistId?: string;
    readonly tmdbId?: string;
    readonly imdbId?: string;
    readonly malId?: string;
    readonly externalIds?: ProviderExternalIds;
  }
  ```
  **No aliases, no relation data.** `titleAliases` exists app-side on
  `TitleInfo` and is never plumbed to providers — no adapter can use it.
- The anime lane already carries AniList ids (Miruro is keyed on them).
- AniList exposes a sequel/prequel **relation graph**; AniDB show pages expose
  `Sequel` links (verified: `attack-on-titan-457` → `attack-on-titan-season-2-459`).
- #265 (landed) closes only the derivable-ordinal sub-case (a "Final Season"
  after the highest numbered sibling). The general case must not be attempted
  with heuristics.
- **The #265 trap to encode in the contract:** a sequel chain is not an
  ordinal. Attack on Titan: base → Season 2 → Season 3 → Season 3 Part 2 →
  Final Season — naive sequel counting yields season 4 = "Season 3 Part 2".
  Any mapping must distinguish *new season* from *continuation of one*.

## Direction (from the issue — the plan's spine)

Stop asking for an ordinal. Resolve the **specific catalog entry the user
picked** — which already *is* the season — and map that entry to a provider
title:

1. `TitleIdentity` (or the resolve input) gains the data adapters need:
   aliases + relation edges (prequel/sequel/season-part), not just flat ids.
2. A shared season→entry mapping service builds the graph once (AniList
   relations primary, AniDB sequel links as corroboration) instead of each
   provider re-guessing.
3. Providers receive "the AniList id of the entry you should play" (or their
   own catalog id when a bridge exists), not "season 2 of <title>".

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Provider tests | `bun run --cwd packages/providers test` | all pass |
| CLI unit | `bun run --cwd apps/cli test:unit` | all pass |
| Full suite | `bun run test --force` | 0 failures |
| Typecheck | `bun run typecheck --force` | exit 0 |

## Scope

**In scope:**
- `packages/types/src/index.ts` — contract additions (alias/relation fields or a richer resolve input)
- `apps/cli/src/domain/catalog/` — the shared season→entry mapping (find the right home via `feature-map.md`; identity reconciliation lives there)
- Anime provider adapters as each mapping lands: `anidb` first (the failing case), then allmanga; miruro needs nothing (already AniList-keyed); hianime + others get a decision per adapter ("hit every seam" — each adapter gets an explicit verdict even if "not supported")
- `packages/storage` `catalog-crosswalk` — likely persistence home for the entry mapping; verify before assuming
- `.docs/architecture.md` + `.docs/providers.md` — the identity-resolution contract
- `.changeset/` — user-facing (anime resolves titles it couldn't before)

**Out of scope:**
- Text-based "arc name → ordinal" heuristics — explicitly rejected by the issue and by `season-routing.ts`'s fail-closed rule.
- Series/movie lanes — anime-only defect.
- Merging with #44/#45 (MAL namespacing/repointing plans) — orthogonal; do not entangle.

## Steps

### Step 1: Design the contract (write it before touching code)

Draft the shape in the PR description first:

- What does a provider's `resolve` input gain? Sketch:
  `TitleIdentity.relatedEntries?: readonly { id, kind: "sequel"|"prequel"|"season-part"|"alternative", relationSource: "anilist"|"anidb", seasonHint?: number }[]`
  plus `aliases?: readonly string[]`.
- Where does the relation graph come from? AniList `relations` edges on the
  catalog fetch; AniDB `Sequel` links for the anidb lane. Define who fetches
  and who caches it (catalog-crosswalk repo is the natural store — check its
  schema first: `packages/storage/src/repositories/catalog-crosswalk.ts`).
- How does "which entry is season N" get decided deterministically: walk the
  prequel chain from the user's picked entry — count only `sequel` edges that
  are new seasons, not `season-part`/`continuation`. The AoT chain is the test
  case that must produce the right answer.

**Verify:** design sketch reviewed against the AoT and Demon Slayer examples
by hand — trace the algorithm on paper; if "Season 3 Part 2" counts as a new
season anywhere, the design is wrong. Fix the design before Step 2.

### Step 2: Contract change in `@kunai/types`

Add the fields to `TitleIdentity`/resolve input. Boundary test
(`boundary-imports.test.ts`) must stay green — types is a leaf package, safe.

**Verify:** `bun run typecheck --force` → exit 0.

### Step 3: Populate the graph (app layer)

Extend the anime-identity resolution path (`domain/catalog/` +
`catalog-crosswalk`) to fetch+store relation edges and aliases when resolving
an AniList title. Cache with an appropriate TTL (relations are stable — long).
Idempotent, migration-safe (new columns/table per existing migration style —
see `packages/storage/src/migrations.ts`).

**Verify:** unit tests over a fixture AniList relations payload → stored
edges; `bun run --cwd apps/cli test:unit`.

### Step 4: AniDB adapter consumes it

`anidb` resolve path: when season-ordinal resolution is needed, prefer the
relation-graph answer over the title-string guess. Keep the fail-closed
behavior for entries with no graph coverage — never fall back to fuzzy title
matching for season selection.

**Verify:** provider test — fixture where title="Demon Slayer", season=2 →
resolves the Entertainment District Arc entry via the graph, not a text match.

### Step 5: Every-adapter verdicts + docs + changeset

Per `AGENTS.md` "hit every seam": record a decision for each provider
(allmanga, miruro, anidb, hianime, vidlink if it ever serves anime, youtube =
n/a). Update `.docs/architecture.md`/`.docs/providers.md` + changeset.

## Test plan

- Unit: relation-graph → season mapping fixtures (AoT full chain: verify S3
  Part 2 is NOT a new season; Demon Slayer arcs map correctly).
- Contract: `TitleIdentity` gains fields; old providers compile unchanged
  (optional fields).
- AniDB adapter: the fail-closed case stays fail-closed (no graph → honest
  failure, not a guess).
- Isolation: `storageRootEnv` for anything touching real stores.

## Done criteria

- [ ] `TitleIdentity` (or resolve input) carries relation/alias data to providers
- [ ] Season→entry mapping is centralized (one service), not per-adapter
- [ ] AoT chain test proves continuation ≠ new season
- [ ] AniDB resolves Demon Slayer S2 correctly *or* fails closed — never wrong
- [ ] Every provider has a recorded verdict in `.docs/providers.md`
- [ ] `bun run test --force` + `typecheck --force` green; changeset present

## STOP conditions

- AniList relation data turns out to mark `PART`/`SEQUEL` inconsistently —
  the design assumed typed edges; if the live schema only gives
  `RELATION_TYPE` strings without season semantics, report before inventing a
  classifier.
- The mapping needs per-title manual curation at scale — that's a product
  decision to escalate, not a code decision to improvise.
- `catalog-crosswalk` schema can't hold relations without a breaking
  migration — report; the migration shape changes the plan's cost.

## Maintenance notes

- Reviewer: the danger is silent wrong-answers. Every new code path must name
  why it's confident (graph edge) or decline (fail closed) — "best text match"
  is a regression.
- Watch Miruro/AniList drift: if AniList adds a `seasonNumber` field later,
  this whole machinery simplifies — leave a comment pointing at that hope.
