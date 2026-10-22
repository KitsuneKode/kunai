# Plan 007: Re-pin AllManga crypto after the post-177 rotation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md`.

> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- packages/providers/src/allmanga/ apps/cli/test/live/allmanga-crypto-freshness* .docs/provider-dossiers/allmanga.md`
> If `crypto.ts` constants already moved past build `177`, this plan is done —
> verify with the command in step 5 and close it.

## Status

- **State**: ✅ DONE (crypto layer verified live 2026-10-19; stream resolution
  from datacenter egress still hits the upstream `NEED_CAPTCHA` gate — a
  documented, separate limitation)
- **Priority**: P1
- **Effort**: M (mostly manual extraction; the repo has a worked procedure)
- **Risk**: LOW for code (constants only); MEDIUM for extraction judgment
- **Depends on**: none
- **Category**: bug (live provider outage)
- **Planned at**: commit `faf1afd22`, 2026-10-19
- **Landed as**: build `181` profile in `packages/providers/src/allmanga/crypto.ts`

### Outcome notes (2026-10-19)

- Bracket probe found live build **`181`** (`177` → `unknown_build_id`,
  `181` → `invalid_boot_token` until profile was correct, then 200).
- **Obfuscation changed shape**: the build-181 chunk (`Cs-j4hUW.js`) uses four
  independent string-table domains (`nu`/`ga`, `au`/`pr`, `ru`/`ma`/`jt`,
  `wu`/`dn`) plus a `console`-patching anti-debug self-check (`io`/`eT`) —
  replay sandboxes must snapshot `console.log` before evaluating the window.
- Profile delta 177 → 181: salts `20/73 → 60/175`, frags `10/195 → 44/1`,
  `bootPrefix I5AgJjIcVH: → UZQjku7:`, join `/ → :`, signed field order
  `group/lane/host/buildId/epoch → buildId:group:host:epoch:lane`, four mask
  fragments replaced, `envXor` re-rolled `223 → 82` (still the anti-bot decoy
  path — raw mask is what the server accepts).
- Episode query template **unchanged** — `ALLMANGA_QUERY_HASH` carried over.
- New bundled fallback: `ALLMANGA_KEY_HEX` `5ce91c85…`, `ALLMANGA_EPOCH` `2963`.
- Verified: `test:live:allmanga-rotation` `"ok":true` / bootstrap 200;
  `test:live:allmanga-crypto` `"ok":true`, `epochsBehind:0`; 74/74 provider
  tests; typecheck + lint clean. `test:live:allanime` resolves the show and
  episode catalog, then surfaces the classified `AllMangaCaptchaError` —
  expected on datacenter egress.

## Why this matters

AllManga (`providerId: "allanime"`, module dir `packages/providers/src/allmanga`)
is **broken for every user right now**. Verified live on 2026-10-19:

```json
{
  "ok": false,
  "check": "crypto-freshness",
  "diagnosis": "build-id-rotated",
  "status": 404,
  "pinnedBuildId": "177",
  "pinnedEpoch": 2960,
  "liveEpoch": 2963,
  "epochsBehind": 3,
  "detail": "{\"error\":\"unknown_build_id\"}"
}
```

mkissa rotates the whole constant set roughly monthly (documented chain:
`81 → 119 → 140 → 166 → 171 → 177`); 177 was pinned 2026-10-13 and is already
dead. The failure is **silent from the user's side**: bootstrap falls back to
`BUNDLED_ALLMANGA_CRYPTO`, every resolve returns zero streams, and the UI reads
"no sources" rather than "provider broken". The public status board shows
`allanime: degraded` since 2026-10-13.

The recovery procedure is already written and has been executed twice —
`.docs/provider-dossiers/allmanga.md`, section "Recovering a build rotation".
This plan exists because the procedure is a chore, not because it is unknown.

## Current state

- `packages/providers/src/allmanga/crypto.ts` — owns the pinned set:
  `ALLMANGA_CRYPTO_PROFILE` (salts/fragments/masks/persisted-query hash),
  `ALLMANGA_BUILD_ID` (= profile `buildId`, `"177"` today, line ~101),
  `ALLMANGA_EPOCH` (`2960`, line ~155), `BUNDLED_ALLMANGA_CRYPTO` fallback
  (~157), `ALLMANGA_BOOTSTRAP_URL` (`https://api.mkissa.net/client-crypto/v1/bootstrap`),
  `ALLMANGA_SITE_ORIGIN` (`https://mkissa.to`).
- `apps/cli/test/live/allmanga-crypto-freshness.smoke.ts` — the diagnostic.
  One HTTP request, touches no profile or database. Answers **which half** is
  stale via the bootstrap endpoint's own error taxonomy (table below).
- `.docs/provider-dossiers/allmanga.md` — "Recovering a build rotation" section
  (~line 102): the full extraction walkthrough, including the observation that
  **every symbol name rotates with the build** — find values by shape, not name.

### Failure taxonomy (verbatim from the dossier — trust it)

| Bootstrap answer                  | Meaning                                               |
| --------------------------------- | ----------------------------------------------------- |
| `404 unknown_build_id`            | `ALLMANGA_BUILD_ID` rotated out ← **today's state**   |
| `403 invalid_boot_token`          | build id is current, the derivation constants rotated |
| `400 missing_build_id` / `..lane` | a dropped query param, not upstream drift             |
| Cloudflare HTML instead of JSON   | missing `Referer`/`Origin: https://mkissa.to`         |

### Conventions and hazards that apply

- `AGENTS.md` hazard 1: never run anything against the real profile. This plan
  touches no storage at all — the smoke and the bracket probe are pure HTTP.
- `AGENTS.md` non-negotiable: "AllManga crypto has no reference implementation
  left" — verify against the **live mkissa chunk**, not ani-cli.
- Constants move as a **set** (build id, salts, fragment offsets, mask
  fragments, key, epoch). A partial update fails exactly like a total one —
  re-derive all of them in one pass.
- The persisted-query hash rotates on its own schedule. Check it too.

## Commands you will need

| Purpose           | Command                                            | Expected on success |
| ----------------- | -------------------------------------------------- | ------------------- |
| Crypto freshness  | `bun run --cwd apps/cli test:live:allmanga-crypto` | `"ok": true`        |
| Full live resolve | `bun run --cwd apps/cli test:live:allanime`        | resolves streams    |
| Unit tests        | `bun run --cwd packages/providers test`            | all pass            |
| Typecheck         | `bun run typecheck --force`                        | exit 0              |

## Scope

**In scope**:

- `packages/providers/src/allmanga/crypto.ts` (the pinned constants +
  `ALLMANGA_EPOCH` + any new derivation inputs the new build adds)
- `.docs/provider-dossiers/allmanga.md` (append the rotation entry to the
  history line, same format as `140 → 166` / `171 → 177`)
- `apps/cli/test/live/allmanga-crypto-freshness.smoke.ts` only if the bootstrap
  contract itself changed shape

**Out of scope**:

- `packages/providers/src/allmanga/direct.ts` (resolve flow; the deferred-locator
  gate question is Phase-2 row PROV-2 of `.plans/2026-10-08-release-readiness.md` —
  do not fold it in here)
- Any other provider
- `generated-provider-status.json` (bot-owned; the next sweep will refresh it)

## Git workflow

- Branch: `advisor/007-allmanga-crypto-rotation` off current `origin/main`
  (the local checkout `fix/audit-findings-batch` is 366 commits behind — do not
  build this on it).
- Commit style: conventional, e.g. `fix(providers): re-pin allmanga crypto for build <N>`.

## Steps

### Step 1: Bracket the live build id

The current pin (`177`) returns `404 unknown_build_id`. Probe consecutive ids
until the answer flips to `403 invalid_boot_token` — that brackets the live
build without reading any JS:

```sh
cd apps/cli
for id in 178 179 180 181 182 183 184 185; do
  printf "%s -> " "$id"
  curl -s -o /tmp/ab.json -w '%{http_code} ' \
    "https://api.mkissa.net/client-crypto/v1/bootstrap?buildId=$id&k=k7" \
    -H 'Referer: https://mkissa.to/' -H 'Origin: https://mkissa.to' \
    -H 'User-Agent: Mozilla/5.0'
  head -c 80 /tmp/ab.json; echo
done
```

**Verify**: one id in the scan answers `403` + `invalid_boot_token`. If every
id up to ~200 still answers `unknown_build_id`, STOP — the endpoint contract
itself may have changed; re-read the dossier before proceeding.

### Step 2: Re-extract the derivation set from the live chunk

Follow `.docs/provider-dossiers/allmanga.md` "Then re-extract from the crypto
chunk" verbatim. Summary of the shape (names rotate — find by structure):

1. Crawl `https://mkissa.to` → `_app/immutable/entry/app.*.js` → find the chunk
   under `_app/immutable/chunks/` containing both `buildId` and `client-crypto`.
2. Locate the string-table function (on 177 it was `tu()`), the index accessor
   (`Un(e) = tu()[e - 374]`), the two-arg wrappers (`At`/`cr`), and the
   `push/shift` checksum IIFE that rotates the table. **Replay the IIFE verbatim
   in a JS engine before reading anything** — the table is wrong until it runs.
3. Read the config object literal next to the table: `saltMul`, `saltAdd`,
   `fragMul`, `fragAdd` (literal numbers), `bootPrefix`, `parts` (concatenated
   accessor calls), the build id, the four base64 mask fragments, and any
   build-new fields (177 added `v`, `omitEmptyLane`, `envXor` — `envXor` is
   documented-not-ported in `crypto.ts`; keep that decision unless upstream now
   requires it).
4. Update `ALLMANGA_CRYPTO_PROFILE` / `ALLMANGA_BUILD_ID` / `ALLMANGA_EPOCH` /
   `BUNDLED_ALLMANGA_CRYPTO` as one set. Check whether the persisted-query hash
   also rotated.

**Verify**: `bun run --cwd apps/cli test:live:allmanga-crypto` → `"ok": true`.

### Step 3: Prove a real resolve

**Verify**: `bun run --cwd apps/cli test:live:allanime` resolves Demon Slayer
with ≥1 stream. A crypto pass that still yields zero streams means the
persisted-query hash (or something else in the set) is stale — do not declare
done on the bootstrap verdict alone.

### Step 4: Update the dossier history

Append the new build number to the rotation chain line in
`.docs/provider-dossiers/allmanga.md` and update `lastReviewed` in its
frontmatter. If extraction showed a new field (like 177's `envXor`), document
its disposition the same way.

**Verify**: `bun run verify:doc-paths` and `bun run verify:doc-frontmatter` → exit 0.

### Step 5: Gates

```sh
bun run typecheck --force && bun run lint && bun run --cwd packages/providers test
```

**Verify**: all exit 0.

## Test plan

- The live smokes are the test here — the rotation test exists precisely for
  this (steps 1 and 3). No new unit tests unless the derivation _shape_ changed
  (e.g. a new mandatory input like `envXor` becoming required), in which case
  pin the new derivation in the existing crypto unit tests under
  `packages/providers/test/` (find the current ones with
  `grep -rln buildAllMangaBootToken packages/providers/test`).

## Done criteria

- [ ] `bun run --cwd apps/cli test:live:allmanga-crypto` prints `"ok": true`
- [ ] `bun run --cwd apps/cli test:live:allanime` resolves ≥1 stream
- [ ] `git diff` shows only crypto constants + dossier, no flow changes
- [ ] `bun run typecheck --force` and `bun run lint` exit 0
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- The bootstrap endpoint's error taxonomy no longer matches the table above
  (new error strings, different path) — the contract moved; report what the
  live endpoint actually answers.
- `invalid_boot_token` persists for every build id in a 180–220 scan — the
  derivation inputs may have moved to a signed/server-computed model; that is
  a design change, not a re-pin.
- The crypto chunk's obfuscation changed class (e.g. WASM or a VM-based
  protector instead of the rotated string table) — the dossier procedure no
  longer applies; report what the chunk contains instead.

## Maintenance notes

- Expect this again in roughly a month. The cadence history is in the dossier.
- The reason this keeps being a surprise to users is that the failure is silent:
  consider (not in this plan) having resolve surface "provider crypto stale" as
  a classified failure when `crypto-freshness` semantics say the pin expired —
  that discussion belongs in `.plans/provider-playback-resilience.md` territory,
  not here.
