# Plan 016: Resolve the `packages/ui-cli` husk, drop `crypto-js`, and de-duplicate HLS parsing

> **Executor instructions**: Follow step by step; verify each step; STOP on any
> STOP condition; update `plans/README.md` when done. These three cleanups are
> independent — do them in order and commit separately.
>
> **Drift check (run first)**: `git diff --stat 4b351cb0..HEAD -- packages/ui-cli packages/providers/src/videasy/direct.ts packages/providers/src/vidrock/direct.ts packages/core`
> Mismatch → re-verify usages before acting.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (ui-cli, HLS) / MED (crypto-js port)
- **Depends on**: none
- **Category**: tech-debt / migration
- **Planned at**: commit `4b351cb0`, 2026-07-16

## Why this matters

Three independent debt items:

1. **`packages/ui-cli` is a reverse-import husk.** Its `src/index.ts` re-exports _back into_ `apps/cli`, inverting monorepo dependency direction; its only importer is a boundary test. It advertises a seam that doesn't exist and can mislead extraction work.
2. **`crypto-js` (maintenance-mode, pure-JS) duplicates `node:crypto`** which is already used ~10 places in the repo, kept alive only for two provider decrypt paths that Bun's built-in `node:crypto` can serve.
3. **HLS master-playlist parsing is re-implemented in four provider `direct.ts` files** (videasy, rivestream, allmanga, miruro), so a quality/label change must be made four times and drifts per provider.

## Current state

### ui-cli husk — `packages/ui-cli/src/index.ts:1-2`

```ts
/** Re-export shim: primitives remain in apps/cli until the shell split completes. */
export { ActionList } from "../../../apps/cli/src/app-shell/primitives/ActionList";
// …all exports reach back into apps/cli/src/app-shell/primitives/*
```

Only importer anywhere: `apps/cli/test/unit/architecture/boundary-imports.test.ts:127`. `package.json` declares `ink`/`react`/`@kunai/design` deps it never actually uses.

### crypto-js — used in exactly two files

- `packages/providers/src/videasy/direct.ts:1716-1757` (SHA256 + AES)
- `packages/providers/src/vidrock/direct.ts`

`node:crypto` is already imported in `apps/cli/src/image/cache.ts`, `services/persistence/SqliteCacheStoreImpl.ts`, `packages/storage/src/repositories/playback-events.ts`, and others. Catalog entry: `crypto-js` + `@types/crypto-js` under the `providers` catalog in root `package.json`.

**IMPORTANT (user constraint):** the user said videasy _internals_ are deferred. The videasy `crypto-js` usage sits in that file. Treat the videasy crypto port as **optional/deferred** in this plan — do the `vidrock` port and the `ui-cli` + HLS items, and only touch videasy's crypto if it can be done as a pure, behavior-identical swap validated by the live smoke. If in doubt, leave videasy's crypto-js alone and keep the dependency until the deferred videasy work.

### HLS parsing — four sites

`EXT-X-STREAM-INF` / `RESOLUTION=` / m3u8 variant parsing appears independently in `packages/providers/src/{videasy,rivestream,allmanga,miruro}/direct.ts`. `packages/core` owns resolver primitives but has no shared master-playlist parser.

Repo conventions: shared provider utilities belong in `@kunai/core` (or a providers-shared util); `node:crypto` synchronous hashing is preferred for small hot-path keys (CLAUDE.md); provider changes are guarded by `packages/providers/test` + live smoke (`test:live:*`). Conventional commits.

## Commands you will need

| Purpose               | Command                                                                               | Expected    |
| --------------------- | ------------------------------------------------------------------------------------- | ----------- |
| Typecheck             | `bun run typecheck`                                                                   | exit 0      |
| Lint                  | `bun run lint`                                                                        | exit 0      |
| Provider tests        | `bun run --cwd packages/providers test`                                               | pass        |
| Core tests            | `bun run --cwd packages/core test`                                                    | pass        |
| Live vidrock (opt-in) | check `apps/cli/package.json` for a vidrock smoke; else `bun run test:live:providers` | resolves    |
| Find usage            | `grep -rn "crypto-js" packages` / `grep -rn "@kunai/ui-cli" .`                        | usage sites |

## Scope

**In scope**:

- `packages/ui-cli/**` (delete the husk, or fill it — see Step 1) + `apps/cli/test/unit/architecture/boundary-imports.test.ts:127` (drop the now-dead reference)
- `packages/providers/src/vidrock/direct.ts` (port crypto-js → node:crypto)
- Root `package.json` catalog (`crypto-js`, `@types/crypto-js`) — remove ONLY if no importer remains (i.e. videasy also ported; otherwise leave)
- New `packages/core/src/hls-master-playlist.ts` (shared parser) + the four provider `direct.ts` consuming it
- Tests in `packages/core/test/` and `packages/providers/test/`

**Out of scope**:

- Videasy internals / videasy crypto port (deferred per user) unless a trivially safe swap — default to leaving it.
- Provider scraping behavior — the HLS parser must produce identical output to each current implementation.

## Git workflow

- Branch: `advisor/016-uicli-cryptojs-hls`
- Three commits: `chore(ui-cli): remove reverse-import husk`, `refactor(vidrock): use node:crypto`, `refactor(providers): share HLS master-playlist parser`.

## Steps

### Step 1: Resolve the ui-cli husk

Decide with the maintainer's stated end-state ("primitives remain in apps/cli until the shell split completes"): since the shell split is plans 011–013 and not done, **delete the husk package** rather than keep a reverse-import shim (it can be recreated for real when the split happens). Remove `packages/ui-cli`, remove its workspace entry if listed, and remove **both** references in `boundary-imports.test.ts`: the `@kunai/ui-cli` import reference at `:127` AND the `"packages/ui-cli/package.json"` entry in the `packageJsonFiles` array at `:267` — that array is `readFileSync`'d, so leaving the entry makes the test throw ENOENT once the package is deleted. Confirm nothing else references it (`grep -rn "ui-cli" apps packages --include=*.ts` and `grep -rn "ui-cli" package.json turbo.json`).

**Verify**: `bun run typecheck && bun run --cwd apps/cli test` → exit 0 / pass.

### Step 2: Port vidrock crypto to `node:crypto`

Replace `crypto-js` SHA256/AES calls in `vidrock/direct.ts` with `node:crypto` equivalents. Match AES mode/padding/encoding exactly (crypto-js defaults: CBC, PKCS7, and its key/IV derivation differ from raw node:crypto — verify byte-for-byte against a known payload). Add a unit test with a fixed input→output vector captured from the current crypto-js path _before_ you change it, then assert the node:crypto path produces the same bytes.

**Verify**: `bun run --cwd packages/providers test` → pass; if a vidrock live smoke exists, run it and confirm it still resolves.

### Step 3: Extract a shared HLS master-playlist parser

Create `packages/core/src/hls-master-playlist.ts` exporting `parseHlsMasterVariants(text: string): HlsVariant[]` (resolution, bandwidth, uri, label). Base it on the most complete of the four existing implementations. Add direct unit tests with representative master playlists. Then switch each of the four `direct.ts` files to consume it, one at a time, keeping their existing per-provider tests green (the parser output must match what each site produced).

**Verify** after each provider switch: `bun run --cwd packages/providers test && bun run --cwd packages/core test` → pass.

### Step 4: Remove crypto-js from the catalog IF unused

`grep -rn "crypto-js" packages`. If videasy still uses it (deferred), leave the catalog entry. If nothing imports it, remove `crypto-js` + `@types/crypto-js` from the root `package.json` catalog and `bun install`.

**Verify**: `bun run typecheck` → exit 0; `bun audit` shows no new issue.

### Step 5: Full gates

**Verify**: `bun run typecheck && bun run lint && bun run --cwd packages/providers test && bun run --cwd packages/core test && bun run --cwd apps/cli test` → all exit 0.

## Done criteria

- [ ] `packages/ui-cli` removed (or filled for real); `@kunai/ui-cli` reference gone from the boundary test; nothing imports it
- [ ] `vidrock/direct.ts` uses `node:crypto`; a fixed-vector test proves byte-identical output
- [ ] `packages/core/src/hls-master-playlist.ts` exists, tested, and consumed by all four providers; per-provider tests green
- [ ] `crypto-js` removed from catalog IFF no importer remains (else left, with videasy noted as the remaining consumer)
- [ ] typecheck/lint exit 0; provider/core/cli tests pass; `plans/README.md` row updated

## STOP conditions

- The vidrock node:crypto port does not reproduce crypto-js output byte-for-byte — STOP; do not ship a decrypt that silently corrupts streams. Keep crypto-js for vidrock and report.
- The four HLS implementations differ in output semantics (not just style) such that one shared parser would change a provider's behavior — report the divergence; unify only the ones that are truly equivalent.
- Deleting `packages/ui-cli` breaks a workspace/turbo config in a non-obvious way — report before forcing.

## Maintenance notes

- Videasy crypto-js port stays deferred with the rest of the videasy internals work; when that happens, finish the crypto-js removal.
- File-overlap note: plan 014 also edits `boundary-imports.test.ts` (adds layer-direction rules; this plan removes the ui-cli entries). Land 014 and 016 sequentially, not in parallel.
- Reviewer: the crypto port is the one risky item — insist on the fixed-vector test.
- The shared HLS parser is the future single point of change for quality/label handling — new providers should consume it, not re-implement.
