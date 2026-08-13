# Plan 035: Route AniDB seasons explicitly

> **Drift check:** `git diff --stat 36da54c4..HEAD -- packages/providers/src/anidb packages/providers/test/anidb.test.ts .docs/providers.md`

**Goal:** A request for season N resolves the sibling AniDB season page before
selecting episode N, without confusing season-relative and absolute episode numbers.

## Status

- **Priority:** P1
- **Effort:** M
- **Risk:** MED
- **Depends on:** plan 031 (soft)
- **Reference:** local ani-cli v5 parses the `Seasons` block on the show page and
  changes to a sibling season slug.

## Tasks

- [ ] Capture sanitized show-page fixtures with one season, multiple seasons, split
  cours, missing labels, and malformed links.
- [ ] Add `listAnidbSeasonLinks(showId)` behind the existing AniDB client seam. Parse
  only links in the Seasons section and validate each slug with `looksLikeAnidbShowId`.
- [ ] Define the numbering rule in tests before implementation:
  - when `absoluteEpisode` is present, use the mapped show id unchanged unless proven
    catalog metadata says otherwise;
  - when only `{season, episode}` is present and season > 1, select the corresponding
    sibling then use the season-relative episode;
  - on ambiguous/missing season mapping, return a diagnosable unsupported-title or
    not-found failure; never silently resolve S1.
- [ ] Cache sibling mapping with the show-page TTL and cancellation semantics already
  used by the client.
- [ ] Emit trace attributes for requested season, selected sibling slug, and numbering
  axis without leaking stream URLs.
- [ ] Add an opt-in live S2 fixture after S1 release signoff is green.

## Verification

```sh
bun run --cwd packages/providers test test/anidb.test.ts
bun run typecheck
bun run lint
bun run fmt:check
bun run test
bun run test:live:anidb
```

**STOP:** AniDB season link order does not correspond reliably to season number. In
that case require catalog-to-sibling evidence rather than guessing by DOM order.
