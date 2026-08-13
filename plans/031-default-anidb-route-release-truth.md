# Plan 031: Make the default AniDB route searchable and signoff-real

> **For agentic workers:** use test-driven development and verification-before-completion.
>
> **Drift check:** `git diff --stat 36da54c4..HEAD -- packages/providers/src/anidb/client.ts packages/providers/test/anidb.test.ts apps/cli/src/services/search/definitions apps/cli/src/services/search/SearchRoutingService.ts apps/cli/test/unit/services/search/search-routing.test.ts apps/cli/test/live/release-provider-signoff.smoke.ts`

**Goal:** The configured default anime path (`anidb`) can find current live titles,
advanced anime search never silently becomes TMDB search, and release signoff tests
the route users actually receive.

**Architecture:** Keep provider-native AniDB browse as the fast simple-query path.
Use AniList as the metadata/advanced-search adapter for every anime provider,
including AniDB. Release evidence must derive its configured provider from the same
default contract, not maintain a stale parallel default.

## Status

- **Priority:** P0
- **Effort:** M
- **Risk:** LOW
- **Planned at:** `36da54c4`, 2026-08-11
- **Evidence:** live `https://anidb.app/browse?q=Frieren` returned absolute anime
  links with a `title` attribute; current parser expects a relative link followed
  by `alt`, so `searchAnidb("Frieren")` returned zero.

## Current defects

- `packages/providers/src/anidb/client.ts:123-138` parses only
  `anime/<slug-id> ... alt="title"`. Current cards use an absolute URL and
  `title="..."`.
- `packages/providers/test/anidb.test.ts` encodes the obsolete markup, so the test
  protects the defect.
- `packages/config/src/defaults.ts:11-16` selects AniDB, but
  `apps/cli/src/services/search/definitions/index.ts` does not list `anidb` as
  AniList-compatible. Advanced search therefore falls through to
  `SearchRegistryImpl.getDefault()`, which is TMDB.
- `apps/cli/test/live/release-provider-signoff.smoke.ts:63-75` still hardcodes
  AllAnime for the anime lane.

## Tasks

### Task 1: Characterize the live AniDB card shape

- [ ] Save a minimal sanitized fixture under
  `packages/providers/test/fixtures/anidb/browse-frieren.html` containing absolute
  and relative links, `title` HTML entities, unrelated anchors, and duplicate ids.
- [ ] Replace the inline obsolete fixture in `packages/providers/test/anidb.test.ts`.
- [ ] Add assertions for exact id/title decoding and deduplication. The test must
  fail before changing the parser.

### Task 2: Replace the brittle cross-tag regex

- [ ] In `packages/providers/src/anidb/client.ts`, parse anime anchors independently
  of attribute order. Accept absolute or relative `/anime/<slug-number>` URLs and
  read the anchor's `title`; keep `alt` only as a compatibility fallback if it is
  present on the same card.
- [ ] Keep `anidbNumericId()` as the final identity gate. Do not accept a bare
  numeric or arbitrary provider id.
- [ ] Return a deterministic empty result on valid pages with no cards; preserve
  typed/network failures from `anidbFetchText`.

### Task 3: Route anime metadata search to AniList

- [ ] Add `anidb` to the AniList definition in both
  `definitions/index.ts` and `definitions/anilist.ts` (or extract one shared list so
  the two declarations cannot drift).
- [ ] Add routing tests proving an advanced anime query on AniDB uses `anilist`,
  while a simple query uses provider-native AniDB and a genuinely empty native
  result falls back to AniList, never TMDB.
- [ ] Assert returned identities preserve `externalIds.anilistId`; do not label a
  TMDB result as an anime-lane identity.

### Task 4: Make release signoff consume the default route

- [ ] Replace the AllAnime anime fixture with a stable AniDB fixture carrying a
  provider-native AniDB id.
- [ ] Add a contract test that the signoff provider for each lane equals the repo
  default (or imports a shared fixture/default builder). A future default change must
  fail one test instead of silently testing the old route.
- [ ] Keep AllAnime as its focused provider smoke, not the default-lane signoff.
- [ ] Require both resolve and stream reachability for AniDB, as movie/series do.

## Verification

```sh
bun run --cwd packages/providers test test/anidb.test.ts
bun run --cwd apps/cli test:file test/unit/services/search/search-routing.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
KUNAI_LIVE_RELEASE_SIGNOFF=1 bun run test:live:release-signoff
```

## STOP conditions

- The live page no longer exposes a stable show slug/id in HTML.
- AniList search cannot preserve a proven AniList identity for AniDB resolution.
- The proposed release fixture only resolves but cannot pass reachability.

Do not promote AllAnime back to default merely to make the stale signoff green.
