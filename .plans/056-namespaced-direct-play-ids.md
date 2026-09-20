# Plan 056: Direct-play by namespaced catalog id (`-i anilist:21`)

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- apps/cli/src/cli-args.ts apps/cli/src/app/bootstrap/bootstrap-intent.ts packages/types/src/share.ts apps/cli/src/app/bootstrap/resolve-share-target.ts`
> Mismatch → re-read `resolveDirectTitle` and the `CatalogNs` union before proceeding.

Closes #92 (direct-play half — the "minimal mode" half already shipped as
`-m/--minimal`, `cli-args.ts:63` + `session-overrides.ts:39`; verify before
doing any minimal-mode work).

## Status

- **Priority:** P3
- **Effort:** M
- **Risk:** LOW-MED — launch-flag parsing; the failure mode to avoid is silently resolving the wrong namespace (same class of bug the codebase calls a "silent no-op")
- **Depends on:** none — #88 (its blocker) is closed; the honesty warnings it demanded already exist
- **Category:** enhancement
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

`resolveDirectTitle` only ever builds `TMDB ${id}` — there is no way to jump
straight to an AniList (or MAL/imdb) id from the command line. The share-link
grammar already namespaces ids as `cat=anilist:21` / `cat=tmdb:1396`; the flag
should reuse that vocabulary (`-i anilist:21`) rather than inventing a second
scheme, so a shared link and a typed flag can never drift apart.

## Current state

```ts
// apps/cli/src/app/bootstrap/bootstrap-intent.ts:161-177
function resolveDirectTitle(args: BootstrapArgs, logs: BootstrapLog[]): TitleInfo | null {
  if (!args.id) return null;
  if (args.anime) {
    logs.push({ kind: "anime-id-unsupported", id: args.id });   // ← the wall
    return null;
  }
  if (args.type === "movie" || args.type === "series") {
    logs.push({ kind: "direct-title", id: args.id, type: args.type });
    return { id: args.id, type: args.type, name: directIdTitleName(args.id) };
  }
  logs.push({ kind: "id-without-type", id: args.id, type: args.type });
  return null;
}
```

- `cli-args.ts:244` — `.option("-i, --id <id>")`; help text at :43 says
  "Open a known TMDB id".
- Share-side vocabulary: `CatalogNs` union + `parseKunaiShareUrl` /
  `readAnchor` in `packages/types/src/share.ts` (:232-235 writes
  `cat=${ns}:${id}`; :261,:330,:350 parse it back). `resolve-share-target.ts:85-100`
  maps `ns`→`externalIds` (`anilist`→`anilistId`, `mal`→`malId`,
  `imdb`→`tt…`, `tmdb`→`tmdbId`, `youtube`→`youtubeId`/`youtubePlaylistId`).
- **The seam to reuse:** `resolveShareTarget` already turns a catalog anchor
  into a `ResolvedShareTarget` with title + externalIds + anime mapping
  (`mapAnimeTitleToProviderNative` handles the `-a` case the flag currently
  refuses). The flag path should funnel into the same anchor shape, not grow
  a parallel mapper.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `bun run --cwd apps/cli test:unit` | all pass |
| Full suite | `bun run test --force` | 0 failures |
| Typecheck | `bun run typecheck --force` | exit 0 |
| Manual smoke | `bun run dev -- -i anilist:21 -a` | resolves One Piece (or clear failure) |

## Scope

**In scope:**
- `apps/cli/src/cli-args.ts` — help text + parsing of `ns:id`
- `apps/cli/src/app/bootstrap/bootstrap-intent.ts` — `resolveDirectTitle`
- The share/catalog-anchor resolution path — reuse, don't fork
- `apps/cli/test/unit/` — flag-parse + intent tests
- `docs/users/cli-reference.mdx` if flag docs are generated/static — check
- `.changeset/` — user-facing flag change

**Out of scope:**
- Minimal mode — already shipped (`-m`). Verify and close that half of the issue in the PR body.
- `--anilist-id` or any second flag — explicitly rejected by the issue.
- Changing share-link parsing.

## Steps

### Step 1: Parse `ns:id` in `resolveDirectTitle`

Accept `anilist:21`, `tmdb:1396`, `mal:5114`, `imdb:tt…`, `youtube:…` — the
`CatalogNs` union members. Bare numeric ids keep today's meaning (tmdb) for
back-compat — record that decision in the code comment and help text.

Behavior rules:
- `-i anilist:21` implies anime mode is *compatible* — remove the
  `anime-id-unsupported` dead end for namespaced ids: when `ns` is `anilist`/
  `mal`, the id is meaningful in anime mode and must resolve, not warn-drop.
  (If the flag is used without `-a`, decide whether anime-typed namespaces
  imply the lane or require `-a` — the less surprising rule: namespace implies
  lane. State it in help text.)
- Unknown `ns` or malformed value → existing honest warning pattern
  (`logs.push({ kind: ... })`), never silent drop — house failure mode.
- Keep the `id-without-type` requirement for bare ids; a namespaced id carries
  its own kind (`anilist`/`mal` → anime/series lane; `imdb`/`tmdb` need `-t`
  as today; `youtube` implies video lane).

**Verify:** `bun run --cwd apps/cli test:unit` → pass with new parse tests.

### Step 2: Resolve through the shared anchor path

`resolveDirectTitle` must produce the same `TitleInfo`+`externalIds` shape a
`cat=ns:id` share link produces — reuse `catalogExternalIds`-equivalent logic
from `resolve-share-target.ts` (extract it to a shared helper if it's not
exported; don't copy it). The anime-lane mapping
(`mapAnimeTitleToProviderNative`) then works identically for flag and link.

**Verify:** unit test asserting `-i anilist:21` and a `cat=anilist:21` share
ref produce equivalent title identity.

### Step 3: Help text + docs + changeset

`cli-args.ts:43` and the `-i` option text: document `ns:id` with an example
(`kunai -i anilist:21 -a`). If `docs/users/cli-reference.mdx` is generated,
regenerate; if static, update. Changeset: `feat(cli): -i accepts namespaced catalog ids`.

## Test plan

- Unit: bare `438631` + `-t movie` → TMDB (unchanged); `anilist:21` → anime
  identity; `mal:5114`; `bogus:1` → warning log, no title; `anilist:21`
  without `-a` → per your decided rule, tested.
- Model after existing bootstrap-intent tests (find
  `test/unit/app/bootstrap/*intent*`).

## Done criteria

- [ ] `-i anilist:21` resolves the AniList entry (not "unsupported")
- [ ] Namespaced and bare ids share one parser; share-link grammar unchanged
- [ ] No silent drops — every rejection has a `logs.push` warning
- [ ] `bun run test --force` + `typecheck --force` green; changeset + docs

## STOP conditions

- `CatalogNs` doesn't include a namespace the plan needs — extend the union in
  `packages/types` deliberately (it's the shared codec), not with a local string.
- Anime lane can't consume `externalIds.anilistId` from a direct title (verify
  `mapAnimeTitleToProviderNative`'s input) — if it only reads a different
  field, adapt the produced TitleInfo, not the grammar.
- `-m` minimal mode turns out to be absent/different from #92's intent —
  verify `session-overrides.ts:29-39` does what the issue wanted before
  claiming that half closed.

## Maintenance notes

- imdb: rejected until a TMDB /find resolution exists.
- The `-i` namespace list is now coupled to `CatalogNs` — adding a share ns
  later should automatically become a valid `-i` ns; keep the parser reading
  the union, not a hardcoded list.
- Reviewer: check the bare-id back-compat and the "namespace implies lane"
  decision are both documented in help output.
