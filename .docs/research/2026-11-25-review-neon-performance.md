---
status: draft
lastReviewed: "2026-11-25T05:35:08Z"
---

# Review: performance, size and distribution (Gemini 4 Neon, 2026-11-25)

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

A point-in-time review by Gemini 4 Neon (Antigravity-2, high thinking), run read-only against `16f4d210c`
(`docs/road-to-9-5-synthesis`, which trails `main`). It is evidence for planning, not authority: the
tree wins where they disagree. File references are as of that commit.

## Verification (2026-11-25, against `main@879b668f4`)

Checked by reading the code and, where marked, by measuring.

| Finding                                                                                              | Verdict                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 `medianResolveMs` never populated; `subtitleSuccessRate` / `streamSurvivalRate` always undefined | **Confirmed.** No provider sets `healthDelta.resolveMs`, so latency ordering of fallbacks has no data.                                                                                                                                                                                   |
| 5.1 selected provider always leads; title-health suggestion discarded                                | **Deliberate**, per comments in `ProviderCandidatePlanner.ts` ("advisory for UX copy only"; "the selected provider leads regardless of how it ranks"). A product decision, not a bug.                                                                                                    |
| 1.1 eight credential-vault spawns in three serial waves                                              | **Partly fixed in #783**: the two tracker loads now share one read (four spawns → two). The probe and config reads remain.                                                                                                                                                               |
| 1.2 SQLite `synchronous = FULL` under WAL                                                            | **Confirmed and fixed in #783.** Measured on ext4/NVMe: fresh migrations ~300 ms → ~67 ms. The review's 126 ms came from `/tmp`, which is tmpfs (fsync is free there). One transaction for all migrations was **not** taken: it would break the twin-launch recovery in `runMigrations`. |
| 1.3 `await graphicsProbeReady` before first paint                                                    | **Confirmed, left as is**: awaited before `checkDeps` on purpose so the dependency snapshot records the image protocol (comment in `main.ts`). Only costs time on terminals that never answer DA1.                                                                                       |
| 2.1 `@xmldom/xmldom` is Android-only                                                                 | **Stale going forward.** Desktop VLC (#764) routes streams through the same stream gateway, so the module is needed on desktop once that lands; and the build uses `splitting: false`, so a dynamic import would save nothing.                                                           |
| 2.2 replace `zod` (M, low risk)                                                                      | **Understated.** `zod` also validates untrusted Stremio addon responses (`stremio-addon/protocol.ts`) and backs `@kunai/schemas`.                                                                                                                                                        |
| 2.3 replace `commander`                                                                              | **Conflicts with a recorded choice** in `cli-args.ts` ("Process argv parsing is intentionally delegated to Commander"). Maintainer decision.                                                                                                                                             |
| 3.1 one-shot `mpv.ts` preflight omits `cachedAt` / `streamReachabilityVerified`                      | **Confirmed** (`mpv.ts`, compare `PersistentMpvSession.ts`).                                                                                                                                                                                                                             |
| Budget headroom "80 bytes at 3135 KiB"                                                               | **Stale number** (older tree); on `main` the budget is 3219 KiB. The point that headroom keeps running out stands.                                                                                                                                                                       |

Not yet verified: 3.1's 2–4 duplicate manifest fetches, 3.2 serial probing and unused `hedgeDelayMs`,
4.1 compression measurements, 4.3 channel gaps, 5.2, 5.3.

## Report

- **Reviewed commit**: `16f4d210c` (`t3/review-startup-performance`, `docs/road-to-9-5-synthesis` on top of `main` `341275881`)
- **Host / runtime**: Linux x64, Bun `1.4.5`
- **Build provenance**: Fresh `KUNAI_BUILD_ANALYZE=1 bun run build` (**0 cached / 10 executed**, 17.518s) after `bun install --frozen-lockfile --offline`.
- **Profile isolation**: Every measurement ran with throwaway `HOME=$(mktemp -d)`, unset `XDG_*` and `KUNAI_CONFIG_DIR`, and `DO_NOT_TRACK=1`. Zero source files were modified; zero live provider network tests were executed.
- **Deduplication against road-to-9.5**: Workstreams already planned there (W1 `PlaybackPhase` / `SessionController` split, W2 `verify:doc-coverage` expansion, W3 `packages/providers` / `packages/storage` strict types, W4 signed `SHA256SUMS`, W5 CLI runtime coverage, W6 prune/dead-code incl. `anidb`, `--player vlc` help text, `provider-hotfix-manifest` production URL/pubkeys, and plan 060 startup budget ratchet) are **not** re-proposed except where this review contributes **new measured evidence** or exposes **unlisted defects**.

---

## Ranked Top-10 Findings

| Rank | Area          | Finding                                                                                                                                                                                                                                                                                                                                               | Measured Fact / Key Evidence                                                                                                                                                                                    | Estimated Impact                                                                                                                                           | Effort  | Risk    |
| ---: | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------- |
|    1 | Providers     | **Provider health ranking is partially a silent no-op**: `medianResolveMs` is never populated by any of the 11 production providers; `subtitleSuccessRate` & `streamSurvivalRate` are hardcoded `undefined`; `TitleProviderHealthService` suggestion is discarded (`void input.suggestion`); and a locally `down` primary provider is never bypassed. | provider-ordering.ts:49-51, provider-health-observation.ts:69-74, ProviderCandidatePlanner.ts:102-112                                                                                                           | **5–30s** saved on every play when the default provider is degraded/down; faster convergence onto fastest healthy mirror per title and globally            | **S–M** | Low     |
|    2 | Cold Start    | **8 OS credential subprocess spawns in 3 serial waves before shell mount**, reading sync tokens **twice** even when AniList & TMDB sync are disabled (`enabled: false`) and probing vault keys even when no secrets exist.                                                                                                                            | **Measured**: 51.6 ms warm on Linux (`secret-tool`); bootstrap-persistence.ts:411-460, ConfigServiceImpl.ts:397-414, credential-vault-io.ts:22-25                                                               | **-40 to -50 ms** on Linux (~40–50% of warm PTY startup); **est. -150 to -400 ms** on macOS (`security`), **est. -500 to -2,000 ms** on Windows (`pwsh`)   | **S**   | Low     |
|    3 | Runtime Speed | **Redundant HLS manifest & segment HTTP fetches across Resolve Gate -> HLS Ladder -> Materializer -> mpv** (plus one-shot `launchMpv` omitting `streamReachabilityVerified` on preflight).                                                                                                                                                            | hls-ladder.ts:97, stream-reachability.ts:374-452, hls-manifest-materializer.ts:74, mpv.ts:344                                                                                                                   | **Est. -300 to -1,500 ms** per HLS play (eliminates 2–4 duplicate CDN round trips & avoids racing single-use tokens)                                       | **M**   | Low–Med |
|    4 | Runtime Speed | **Serial candidate probing inside resolve gate & unused intra-provider hedging (`runProviderCycleRaced`)**: top 3 streams and distinct hosts are probed sequentially; `hedgeDelayMs` in `provider-cycle-engine.ts` has 0 callers across all 11 providers.                                                                                             | direct-stream-source.ts:195-256, resolve-gate.ts:144-160, provider-cycle-engine.ts:51                                                                                                                           | **2–3× faster** failover when primary host/mirror stalls or returns 403/timeout (saves **2–12 s** on dead first host)                                      | **M**   | Medium  |
|    5 | Bundle Size   | **`dist/kunai.js` has only 80 bytes of budget headroom** (`3,210,160 B` vs `3,210,240 B`), while shipping Android-only `@xmldom/xmldom` (**92.6 KiB**) into desktop binaries, `zod` v4 (**94.5 KiB**) for 5 narrow runtime parses, and `commander` (**39.3 KiB**) on top of a hand-written flag parser.                                               | **Measured**: `build-meta.json` & `kunai-linux-x64.meta.json`; build-shared.ts:453, bootstrap-services.ts:16, cli-args.ts:181-486                                                                               | **-233 to -246 KiB** (-7.4% of JS bundle; restores ~235 KiB budget headroom) + up to **-262 KiB** asset reduction if VidKing WASM is compressed or retired | **M**   | Low     |
|    6 | Cold Start    | **61 separate SQLite migration transactions under default `synchronous = FULL`** + **blocking `await graphicsProbeReady` (100 ms Unix / 400 ms Windows)** before shell mount.                                                                                                                                                                         | **Measured**: fresh DB migrations **126.3 ms** (PTY first frame 101.6 ms warm -> 216.0 ms fresh); DA1 timeout stalls PTY first frame **+110.3 ms** (101.6 ms -> 211.9 ms); migrations.ts:1182-1227, main.ts:966 | **-95 to -115 ms** on first launch (fresh DB) + **-100 ms Unix / -400 ms Windows** on terminals that don't answer DA1                                      | **S**   | Low     |
|    7 | Distribution  | **Archive size & self-updater RAM/ceiling crunch**: binary is 118.78 MiB (55.36 MiB `.tar.gz`) against hardcoded `128 MiB` / `64 MiB` ceilings in shipped updaters (already blocking bytecode on Windows x64 & Android x64), and `install-latest.ts` buffers the entire archive + extracted binary in JS RAM (~180–240 MiB peak).                     | **Measured**: `zstd -19` -> **44.45 MiB (-20.0%)**, `xz -6` -> **42.10 MiB (-24.2%)**; platform-assets.ts:17-18, install-latest.ts:228-235, build-shared.ts:200-204                                             | **-11 to -13.4 MiB** smaller downloads per release; prevents OOM on Termux/small VPSs; unlocks bytecode for Windows/Android                                | **M**   | Low–Med |
|    8 | Cold Start    | **Eager `@kunai/providers` barrel import in `ui.ts:17` + synchronous `curl --version` & Windows `powershell.exe` process-start-id probe during boot** + eager construction of non-first-paint services.                                                                                                                                               | **Measured**: `import @/ui` **32.8 ms** cold, `curl --version` **4.5–9.4 ms** every launch; ui.ts:17,194-201, bootstrap-services.ts:150-517, process-owner-identity.ts:61-103                                   | **-20 to -45 ms** on Linux/macOS; **est. -300 to -1,500 ms** on Windows (`powershell.exe` spawn)                                                           | **S–M** | Low     |
|    9 | Providers     | **Initial startup stream selection ignores bitrate, HDR preference, and subtitle coverage**: `selectReadyStream` sorts only by `qualityRank` (resolution height), ignoring parsed HLS `bandwidth`, `hdrMode` (only applied in manual switcher), and subtitle presence.                                                                                | startup-selection.ts:93-112, source-quality.ts:504-533, hls-ladder.ts:22                                                                                                                                        | Higher visual fidelity on first frame and fewer manual source switches                                                                                     | **S**   | Low     |
|   10 | Runtime Speed | **Serial pre-resolve & fallback timing waits**: `fetchSeasons(title.id)` runs after `await catalogDetailPromise`; fallback provider discard triggers serial `await getPlaybackTimingMetadata` before mpv launch; anime search blocks UI on serial AniList enrichment.                                                                                 | PlaybackPhase.ts:819,916,2404-2419, SearchRoutingService.ts:233-268                                                                                                                                             | **Est. -200 to -1,200 ms** on series launch, fallback play, and anime search                                                                               | **S**   | Low     |

---

## Methodology: Measured Facts vs Estimates

- **Directly measured (Linux x64, Bun 1.4.5, non-cached build)**:
  - `KUNAI_BUILD_ANALYZE=1 bun run build` outputs (`apps/cli/dist/kunai.js`, `apps/cli/dist/build-meta.json`, `apps/cli/dist/bin/kunai-linux-x64`, `apps/cli/dist/bin/kunai-linux-x64.meta.json`, `apps/cli/dist/bin/kunai-linux-x64.tar.gz`).
  - Wall-clock timings of the compiled binary and npm bundle across CLI fast paths, `--support-bundle`, and real PTY interactive launches (measuring time to DA1 query and time to first non-query rendered frame).
  - Phase-by-phase micro-profiling of `apps/cli/src/` startup modules (cold import + fresh SQLite DB vs warm cached imports + existing DB) and `Bun.spawn` call tracing of the OS credential vault.
  - Real `gzip -9`, `zstd -19`, and `xz -6` archive sizes on the freshly built `kunai-linux-x64` binary.
- **Estimated / not directly measurable on this host (and why)**:
  - **macOS (`security`, `ps`, `codesign`) and Windows (`pwsh`, `powershell.exe`, SmartScreen) cold-start timings**: Linux x64 host cannot execute macOS or Windows binaries; subprocess costs are marked as estimates derived from the exact `Bun.spawn` / `Bun.spawnSync` call counts observed in code.
  - **Live provider & CDN runtime latencies**: Prompt policy prohibits network-heavy live provider tests; runtime savings in Sections 3 and 5 are calculated from exact serial HTTP round-trip counts, timeout constants, and retry policies in source code.
  - **Termux / Android runtime behavior**: Measured statically from build scripts, launcher, and `install-latest.ts` buffer allocations (no Android device attached).

---

## 1. Cold Start

### Measured Timings

All benchmarks ran against the freshly compiled binary (`apps/cli/dist/bin/kunai-linux-x64`, bytecode enabled) and npm bundle (`apps/cli/dist/kunai.js`) in isolated throwaway `HOME` directories with `XDG_*` and `KUNAI_CONFIG_DIR` unset and `DO_NOT_TRACK=1`.

#### A. CLI & Interactive PTY Wall-Clock Benchmarks (Measured)

| Scenario                                            | Runs |      Min |       Median |     Mean |      Max | Command / Harness                                                                                                                                              |
| --------------------------------------------------- | ---: | -------: | -----------: | -------: | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compiled binary `--version`                         |    7 |  19.2 ms |  **20.8 ms** |  21.8 ms |  29.2 ms | `apps/cli/dist/bin/kunai-linux-x64 --version`                                                                                                                  |
| Compiled binary `--help`                            |    7 |  18.5 ms |  **20.4 ms** |  21.3 ms |  26.8 ms | `apps/cli/dist/bin/kunai-linux-x64 --help`                                                                                                                     |
| Compiled binary `--dry-run`                         |    7 |  18.9 ms |  **21.1 ms** |  21.2 ms |  23.8 ms | `apps/cli/dist/bin/kunai-linux-x64 --dry-run`                                                                                                                  |
| Compiled binary `capabilities --json`               |    7 |  19.1 ms |  **21.1 ms** |  22.0 ms |  28.6 ms | `apps/cli/dist/bin/kunai-linux-x64 capabilities --json`                                                                                                        |
| npm bundle `bun dist/kunai.js --version`            |    7 | 108.9 ms | **112.6 ms** | 115.1 ms | 132.3 ms | `bun apps/cli/dist/kunai.js --version`                                                                                                                         |
| npm bundle `bun dist/kunai.js --help`               |    7 |  98.6 ms | **115.5 ms** | 112.0 ms | 120.1 ms | `bun apps/cli/dist/kunai.js --help`                                                                                                                            |
| Compiled binary `--support-bundle` (warm DB)        |    5 | 180.9 ms | **202.1 ms** | 220.9 ms | 320.1 ms | `apps/cli/dist/bin/kunai-linux-x64 --support-bundle`                                                                                                           |
| Compiled binary `--support-bundle` (fresh DB)       |    5 | 295.8 ms | **326.6 ms** | 330.7 ms | 371.2 ms | `apps/cli/dist/bin/kunai-linux-x64 --support-bundle`                                                                                                           |
| **PTY interactive (warm DB, DA1 immediate reply)**  |    5 |  94.2 ms | **101.6 ms** | 117.1 ms | 188.0 ms | `python3 pty.openpty()` launching `kunai-linux-x64` (`offlineMode: true`, pre-seeded config, immediate `\x1b?62;4c` DA1 reply; DA1 emitted at med **24.7 ms**) |
| **PTY interactive (fresh DB, DA1 immediate reply)** |    5 | 197.3 ms | **216.0 ms** | 216.0 ms | 233.0 ms | Same PTY harness without pre-seeded SQLite DBs (DA1 at med **28.9 ms**)                                                                                        |
| **PTY interactive (warm DB, no DA1 reply)**         |    5 | 208.4 ms | **211.9 ms** | 233.6 ms | 300.8 ms | Same PTY harness with silent terminal (hits 100 ms DA1 timeout; DA1 at med **28.3 ms**)                                                                        |

_Note on fast paths_: [main.ts:1590 already short-circuits `--version`, `--help`, `--dry-run`, and `capabilities --json` before container or Ink initialization, which keeps compiled binary fast paths at ~20.5 ms (whereas `bun dist/kunai.js --version` pays ~92 ms of Bun JS parse/load overhead for the 3.13 MiB uncompiled bundle).

#### B. Startup Phase Breakdown (Measured in `apps/cli` via `bun -e`)

| Phase                                                          | Cold (first import + fresh DB) | Warm (cached modules + existing DB) |
| -------------------------------------------------------------- | -----------------------------: | ----------------------------------: |
| `import @kunai/storage`                                        |                       112.0 ms |                              0.0 ms |
| `import @/ui` (transitively imports `@kunai/providers` barrel) |                        32.8 ms |                              0.0 ms |
| `resolveAnidbCurl()`                                           |                         6.4 ms |                              0.7 ms |
| `Bun.spawnSync(curl --version)`                                |                         9.4 ms |                              4.5 ms |
| `checkDeps(silent: true)` total                                |                        11.1 ms |                              8.0 ms |
| `open dataDb` + `open cacheDb`                                 |                        13.3 ms |                              1.1 ms |
| **`runMigrations(dataDb)` + `runMigrations(cacheDb)`**         |     **126.3 ms** (95.9 + 30.4) |              **0.8 ms** (0.6 + 0.2) |
| **`createCredentialVault()`** (`secret-service` probe)         |                    **50.5 ms** |                         **14.5 ms** |
| `loadProductionProviderModules()` (already loaded via `@/ui`)  |                         2.1 ms |                              0.3 ms |
| `import @/container`                                           |                       139.0 ms |                              0.0 ms |
| **`createContainer()` (full)**                                 |                   **108.9 ms** |                         **70.8 ms** |
| `import ink-shell`                                             |                       253.8 ms |                              0.1 ms |

### Cold-Start Findings

#### 1.1 — 8 OS Credential Subprocess Spawns in 3 Serial Waves Before Shell Mount

- **What**: During `bootstrapPersistence` + `bootstrapServices`, Kunai spawns `secret-tool` (Linux) / `security` (macOS) / `pwsh` (Windows) **8 times across 3 serial waves** before the UI renders, even on a brand-new profile with zero secrets and sync disabled. Worse, `vaultSyncTokenFileIo.readTokens()` fetches **both** `anilist.tokens` and `tmdb.tokens` on every call, and `anilistAdapter.init()` + `tmdbAdapter.init()` call it concurrently, causing **4 redundant token lookups** even when `config.sync.anilist.enabled === false && config.sync.tmdb.enabled === false`.
- **Evidence**:
  - **Measured** (`Bun.spawn` trace in isolated throwaway `HOME` on warm DB):
    - Wave 1 (`createCredentialVault`, **25.8 ms**): `[#1] secret-tool lookup service kunai key __probe__` — credential-vault-backends.ts:240-260, bootstrap-persistence.ts:411-413.
    - Wave 2 (`ConfigServiceImpl.load`, **13.7 ms**): `[#2] videasy.sessionToken`, `[#3] tmdb.apiKey`, `[#4] wyzie.apiKey` — ConfigServiceImpl.ts:397-414.
    - Wave 3 (`Promise.all([anilistAdapter.init(), tmdbAdapter.init()])`, **12.1 ms**): `[#5] anilist.tokens`, `[#6] tmdb.tokens`, `[#7] anilist.tokens`, `[#8] tmdb.tokens` — bootstrap-persistence.ts:452-460, credential-vault-io.ts:22-25.
    - Total measured subprocess overhead on Linux: **51.6 ms** (nearly half of the 101.6 ms warm PTY first frame).
- **Estimated impact**:
  - Persist a non-secret `vaultKeysPresent` hint in `config.json` (or defer vault probe & reads until a secret is actually requested) + skip `syncAdapter.init()` when `sync.{anilist,tmdb}.enabled === false` + deduplicate `readTokens()` via a single-flight cache.
  - Saves **~45–51 ms** on Linux (bringing warm PTY first frame from ~102 ms to ~55 ms); **estimated -150 to -400 ms** on macOS (`security`) and **-500 to -2,000 ms** on Windows (`pwsh` DPAPI cold spawns).
- **Effort**: **S**
- **Risk**: Low (fallback to live vault read if user explicitly configures a secret or enables sync; keep migration path for existing vault-backed configs via one-time marker).

#### 1.2 — 61 Separate SQLite Migration Transactions Under Default `synchronous = FULL`

- **What**: `openKunaiDatabase` sets `PRAGMA journal_mode = WAL` but leaves `PRAGMA synchronous` at SQLite's default (`FULL`), and `runMigrations` executes each of the ~61 migrations in its own `BEGIN`/`COMMIT` transaction, causing ~61 `fsync` barriers on first launch.
- **Evidence**:
  - **Measured**: `runMigrations(dataDb)` = **95.9 ms**, `runMigrations(cacheDb)` = **30.4 ms** (total **126.3 ms**). In the compiled binary PTY benchmark, fresh DB first frame is **216.0 ms** vs **101.6 ms** warm (**+114.4 ms**).
  - Code: sqlite.ts:66-79, migrations.ts:1182-1227.
- **Estimated impact**: Setting `PRAGMA synchronous = NORMAL` (standard safe WAL setting) and wrapping pending migrations in a single outer transaction (or fresh-schema snapshot at current version) saves **~95–115 ms** on first launch and reduces runtime write stalls.
- **Effort**: **S**
- **Risk**: Low (`synchronous = NORMAL` in WAL mode is crash-safe against process crashes; only OS power loss can roll back the last uncheckpointed transaction).

#### 1.3 — `await graphicsProbeReady` Blocks First Paint When Terminal Doesn't Reply to DA1

- **What**: `main.ts` awaits `graphicsProbeReady` synchronously before `checkDeps`, `createContainer`, and `import("@/app-shell/ink-shell")`. Any terminal that ignores DA1 (multiplexers, dumb/minimal terminals, pipes, slow Windows conhost) burns the entire timeout before Ink even starts mounting.
- **Evidence**:
  - **Measured**: Compiled binary PTY first frame jumped from **101.6 ms** (immediate DA1 reply) to **211.9 ms** (**+110.3 ms**) when DA1 did not reply.
  - Code: main.ts:966, probe.ts:83-85 (`100 ms` Unix / `400 ms` Windows).
- **Estimated impact**: Run `graphicsProbeReady` in parallel with `createContainer()` + `import("@/app-shell/ink-shell")` (only awaiting before Ink switches raw mode, or resolving capability into state asynchronously after first text frame). Saves **~100 ms** on non-DA1 Unix terminals and **est. ~400 ms** on Windows.
- **Effort**: **S**
- **Risk**: Low (only ensure stdin raw-mode reader hands off cleanly before Ink takes stdin).

#### 1.4 — Eager `@kunai/providers` Barrel Import, Synchronous `curl --version`, and Windows `powershell.exe` Startup Probe

- **What**: Four avoidable synchronous/eager costs run before the shell mounts:
  1. ui.ts:17 imports `{ resolveAnidbCurl } from "@kunai/providers"`, which main.ts:926 pulls eagerly before `createContainer()`, loading all 12 provider modules (including retired `anidb`) up front.
  2. ui.ts:194-201 runs `Bun.spawnSync([curl.path, ...prefixArgs, "--version"])` on every interactive launch even in non-anime modes, and bootstrap-services.ts:203 calls `whichLive("ffprobe")` a second time even though `capabilitySnapshot.ffprobe` already resolved it.
  3. bootstrap-services.ts:310 calls `processStartId(process.pid)` (process-owner-identity.ts:61-103): fast on Linux (`/proc/<pid>/stat`), but runs **`Bun.spawnSync("ps", ...)` on macOS** and **`Bun.spawnSync("powershell.exe", ...)` (2,000 ms timeout!) on Windows** synchronously during boot just to tag the queue session.
  4. bootstrap-services.ts:150-517 and bootstrap-persistence.ts:324 eagerly instantiate `DownloadService`, `PresenceServiceImpl`, `SyncService`, `RecommendationServiceImpl`, `TimelineService`, `OfflineRunwayService`, `HistoryMetadataHealer`, `offlineAssetService.purgeOrphanedAssets()`, `runOfflineAssetIdentityBackfill()`, and `queueRepository` recovery before Ink mounts.
- **Evidence**:
  - **Measured** (source TS pass): `import @/ui` = **32.8 ms** cold; `Bun.spawnSync(curl --version)` = **4.5–9.4 ms** every launch; `createContainer()` warm = **70.8 ms**.
  - Code citations above.
- **Estimated impact**: Lazily resolving `curl --version` when an anime provider needs curl, lazily computing `processStartId` (or using a native Win32/FFI/fallback UUID + PID when queue isn't shared), moving `resolveAnidbCurl` out of the `@kunai/providers` barrel, and deferring non-first-paint services (`DownloadService`, `PresenceServiceImpl`, `purgeOrphanedAssets`, `HistoryMetadataHealer`) to post-mount saves **~15–40 ms** on Linux/macOS and **est. 300–1,500 ms** on Windows.
- **Effort**: **S–M**
- **Risk**: Low (keep container getters lazy or warm via `queueMicrotask`/post-first-frame hook).

---

## 2. Bundle and Binary Size

### Measured Build Footprint (`KUNAI_BUILD_ANALYZE=1 bun run build`, non-cached)

| Artifact                                                            |                                     Measured Size |                     Budget (build-shared.ts) |                    Headroom |
| ------------------------------------------------------------------- | ------------------------------------------------: | -------------------------------------------: | --------------------------: |
| `apps/cli/dist/kunai.js` (npm bundle)                               |                     **3,210,160 B (3,134.9 KiB)** | `NPM_BUNDLE_BUDGET_KB = 3_135` (3,210,240 B) |                **80 bytes** |
| `apps/cli/dist/assets/*` (8 files)                                  |                         **317,225 B (309.8 KiB)** |                                            — |                           — |
| `apps/cli/dist/bin/kunai-linux-x64` (compiled, bytecode on)         |                    **124,549,296 B (118.78 MiB)** |     `124 MiB` target / `128 MiB` updater cap | **5.22 MiB** / **9.22 MiB** |
| `apps/cli/dist/bin/kunai-linux-x64.tar.gz`                          |                      **58,044,032 B (55.36 MiB)** | `64 MiB` updater cap (platform-assets.ts:18) |                **8.64 MiB** |
| Bundled JS module graph inside binary (`kunai-linux-x64.meta.json`) | **3,302,658 B (3,225.3 KiB)** across 1,204 inputs |      0 duplicated multi-version npm packages |                           — |

#### Top npm Inputs in Compiled Binary (Measured from `kunai-linux-x64.meta.json`)

| Package                                                        | Bundled Bytes | Files | Primary Role                                                     |
| -------------------------------------------------------------- | ------------: | ----: | ---------------------------------------------------------------- |
| `react-reconciler`                                             | **129.1 KiB** |     2 | Ink React renderer                                               |
| `yoga-layout` (`yoga-wasm-base64-esm.js`: 119.0 KiB)           | **125.6 KiB** |     3 | Ink flexbox layout                                               |
| `zod`                                                          |  **94.5 KiB** |    28 | Only 5 runtime files (`config/schema.ts` + 4 SQLite cache repos) |
| `@xmldom/xmldom` (`entities.js`: 35.5 KiB, `dom.js`: 29.9 KiB) |  **92.6 KiB** |     8 | **Android-only** DASH manifest rewriter                          |
| `ink`                                                          |  **69.1 KiB** |    39 | Terminal UI                                                      |
| `commander`                                                    |  **39.3 KiB** |     7 | CLI arg parsing (after manual pre-parser!)                       |
| `slice-ansi` / `chalk` / `wrap-ansi` / `ansi-styles`           |  **30.4 KiB** |    12 | Terminal styling                                                 |
| `@assemblyscript/loader`                                       |   **5.5 KiB** |     1 | VidKing WASM loader                                              |

#### Top Source Buckets & Assets (Measured)

- **Source buckets**: `cli:app-shell` **471.3 KiB** (166 files), `cli:app/playback` **168.3 KiB** (`PlaybackPhase.ts` alone is **74.2 KiB**), `pkg:storage` **158.3 KiB** (`migrations.ts` **35.1 KiB**), `cli:infra/player` **127.0 KiB**, `cli:services/update` **105.7 KiB**, `cli:services/diagnostics` **74.2 KiB**, `cli:app-shell/workflows` **73.2 KiB**, `cli:services/catalog` **72.1 KiB**, `cli:app-shell/settings` **68.1 KiB**, `pkg:providers/shared` **60.6 KiB**, `cli:services/download` **57.1 KiB**.
- **Embedded assets (`dist/assets/*`, 309.8 KiB)**: `module1_patched.wasm` (**256.8 KiB**, Videasy/VidKing), `kunai-bridge.lua` (**31.6 KiB**), 6 Kanna PNGs (**21.6 KiB** total).
- **Verified clean**: `cineby`, `rgshows`, `research`, and `jpeg-js` (listed in apps/cli/package.json:137, test-only via `test/support/image-fixtures.ts:7`) contribute **0 B** to the production bundle. `jpeg-js` can move to `devDependencies`.

### Concrete, Safe Size Reductions

#### 2.1 — Gate Android-Only `@xmldom/xmldom` + `HandoffPlayerService` / `dash-gateway-manifest` Out of Desktop Binaries

- **What**: bootstrap-services.ts:16 statically imports `HandoffPlayerService`, which imports `stream-gateway` -> `dash-gateway-manifest` -> `@xmldom/xmldom`. On Linux/macOS/Windows, player-choice.ts:48-57 can never return `kind: "android-handoff"`.
- **Evidence**: `@xmldom/xmldom` = **92.6 KiB** + `dash-gateway-manifest` / `stream-gateway` / `HandoffPlayerService` = **~16 KiB** measured in `kunai-linux-x64.meta.json`.
- **Estimated impact**: **~108 KiB** removed from all 8 desktop binaries (and lazily loaded via dynamic `import()` on npm/Android only when `playerMode.kind === "android-handoff"`). Also reduces startup JS parse work.
- **Effort**: **S** (compile-time target `define` or dynamic `import()` guarded by `process.platform === "android"`).
- **Risk**: Low.

#### 2.2 — Replace 5 Narrow Runtime `zod` Schemas with Lightweight Type Guards

- **What**: `zod` v4 adds **94.5 KiB** (28 files) to both `dist/kunai.js` and every binary, yet runtime code only imports it in 5 files: packages/config/src/schema.ts (validating a 5-field `providerRelay` object) and 4 SQLite cache repositories (`stream-cache`, `provider-health`, `provider-endpoint-health`, `resolve-trace` under `packages/storage/src/repositories/`).
- **Evidence**: Measured **94.5 KiB** (`96,768 B`) in `kunai-linux-x64.meta.json` and `build-meta.json`.
- **Estimated impact**: **~92–94 KiB** saved in `dist/kunai.js` (immediately freeing ~3% of the entire npm bundle budget) and all compiled binaries.
- **Effort**: **M**
- **Risk**: Low (all 5 schemas are small, fixed-shape structs already covered by unit tests).

#### 2.3 — Replace `commander` with Built-in `node:util` `parseArgs`

- **What**: cli-args.ts:181-470 already maintains explicit `KNOWN_FLAGS`, `VALUE_FLAGS`, `SUBCOMMAND_ONLY_FLAGS`, short-flag expansion, and Levenshtein typo detection before handing normalized argv to `commander` at cli-args.ts:326-486.
- **Evidence**: Measured **39.3 KiB** (`commander`, 7 files) in `kunai-linux-x64.meta.json`.
- **Estimated impact**: **~38–39 KiB** saved in `dist/kunai.js` and binaries, plus slightly faster `--version`/`--help` cold start.
- **Effort**: **S**
- **Risk**: Low (`cli-args` already has thorough unit tests).

#### 2.4 — Compress or Retire VidKing `module1_patched.wasm` (256.8 KiB) + Remove Bundled Retired `anidb` (6.5 KiB)

- **What**:
  - `packages/providers/src/videasy/assets/module1_patched.wasm` (**256.8 KiB** uncompressed) + `@assemblyscript/loader` (**5.5 KiB**) are embedded in every binary even though Videasy is last in fallback order and marked broken/legacy in defaults.ts:41-48.
  - Retired `anidb` (5 files, **6.5 KiB**) is still pulled into the bundle via packages/providers/src/index.ts:9-10 (already scheduled in road-to-9.5 W6 prune; confirmed still bundled at HEAD).
- **Evidence**: Measured from `apps/cli/dist/assets/module1_patched.wasm` (262,965 B) and `kunai-linux-x64.meta.json`.
- **Estimated impact**: **~6.5 KiB** immediately from removing `anidb`; **~100–150 KiB** raw asset reduction if `module1_patched.wasm` is gzip-compressed and lazily decompressed via `Bun.gunzipSync`, or **~262 KiB** if Videasy is retired.
- **Effort**: **S**
- **Risk**: Low.

#### 2.5 — Note on Bytecode, Minification, and Compiled Binary Size Floor

- **Measured facts**:
  - `build-shared.ts` already enables `minify: true` and `bytecode: true` for 8/10 targets (build-shared.ts:198-204). Bytecode adds ~11 MiB to the compiled binary (which pushed `windows-x64` to 124.6 MiB and `android-x64` to 129.1 MiB, forcing `bytecode: false` on those two targets to stay under `MAX_RELEASE_BINARY_BYTES = 128 MiB`).
  - Because ~104 MiB of the 118.78 MiB `kunai-linux-x64` binary is the embedded Bun single-file runtime + ~11 MiB JSC bytecode and only **3.22 MiB** is Kunai's JS graph, JS trimming alone will meaningfully save the **npm bundle budget** (taking `dist/kunai.js` from 3,134.9 KiB down to ~2,890 KiB) and startup parse latency, while **archive download size** requires better compression or delta updates (see Section 4).

---

## 3. Speed at Runtime (Search -> Resolve -> First Frame)

#### 3.1 — Duplicate HLS Manifest & Segment Round Trips Across 4 Pipeline Stages

- **What**: For HLS streams (the majority of `vidlink`, `rivestream`, `vidrock`, `movy`, `hianime`, `miruro`, and `allmanga` streams), Kunai fetches the same master/media playlists repeatedly in series:
  1. Provider calls `expandHlsMasterInventory()` (hls-ladder.ts:97) -> **HTTP GET #1** (master m3u8), then discards the playlist text.
  2. `verifyCandidateStream()` / `selectVerifiedStream()` (stream-reachability.ts:374-452) fetches master m3u8 (**GET #2**) -> variant m3u8 (**GET #3**) -> first media segment (**GET #4**), serially, retrying the entire chain once on timeout/non-definitive failure (stream-health.ts:141-150, up to `2 × 6 s = 12 s`), and discards the playlist text again.
  3. PlayerServiceImpl.ts:190 calls `materializeHlsManifestForPlayback()` (hls-manifest-materializer.ts:74), which fetches the **same** master/media m3u8 again serially before launching mpv (with a 30 s timeout!).
  4. On one-shot playback (first play before persistent mpv exists, or when persistent mpv is off), mpv.ts:344 calls `checkStreamPreflight(opts.url, opts.headers, 3_000, { requiresYtdl: opts.requiresYtdl })` **without passing `cachedAt` or `streamReachabilityVerified`** — unlike PersistentMpvSession.ts:444-448. Per stream-health.ts:187-197, omitting those two fields forces **another** live HLS/direct probe right as mpv opens the URL.
- **Evidence**: Exact call chain verified at the lines cited above.
- **Estimated impact**: Threading a short-lived in-memory manifest cache (`Map<url, { body, finalUrl, fetchedAt }>` with ~15 s TTL) through ladder expansion -> `verifyCandidateStream` -> `materializeHlsManifestForPlayback`, plus passing `cachedAt` & `streamReachabilityVerified` in mpv.ts:344, eliminates 2–4 CDN HTTP round trips per play (**est. -300 to -1,500 ms** time-to-first-frame) and prevents preflight from racing single-use CDN tokens.
- **Effort**: **M** (`mpv.ts:344` fix alone is **S**).
- **Risk**: Low (manifests are immutable/ephemeral over a <15 s resolve-to-launch window; live streams with `isLive: true` bypass cache).

#### 3.2 — Serial Resolve-Gate Probing & Unused Intra-Provider Mirror Racing

- **What**:
  - direct-stream-source.ts:195-256 probes `streams.slice(0, 3)` **strictly serially** in a `for` loop.
  - resolve-gate.ts:144-160 (`selectVerifiedStream`, used by `rivestream`, `movy`, `hianime`, `animegg`) also probes distinct-host candidates **strictly serially**.
  - provider-cycle-engine.ts:51 already implements `runProviderCycleRaced` with `hedgeDelayMs`, yet **0 of 11 production providers** pass `hedgeDelayMs` (all 5 cycle-based providers — `rivestream`, `videasy`, `movy`, `miruro`, `allmanga` — walk servers one by one).
- **Evidence**: Repo-wide grep for `hedgeDelayMs` under `packages/providers/src/` returned zero callers; serial `for (...) { await verifyCandidateStream(...) }` verified in `direct-stream-source.ts:195-256` and `resolve-gate.ts:144-160`.
- **Estimated impact**: Bounded-concurrency probing (2–3 distinct-host candidates in parallel, aborting losers once the highest-ranked viable candidate passes) + enabling a 1.5–2.5 s `hedgeDelayMs` on multi-mirror providers cuts dead-first-host worst-case latency by **2–3×** (**est. -2 to -12 s** when top mirror stalls).
- **Effort**: **M**
- **Risk**: Medium (must preserve quality-priority ordering when a lower-res mirror responds 50 ms faster than a 1080p mirror — e.g. brief quality grace window or prefer-rank-order completion — and cap concurrency at 2–3 to avoid CDN rate limits).

#### 3.3 — Serial Pre-Resolve, Fallback Timing Refetch, and Non-HLS HEAD->GET Wait

- **What**:
  1. **TMDB series `fetchSeasons` runs serially after `await catalogDetailPromise`**: In PlaybackPhase.ts:819,916, `title.id` is already known before `catalogDetailPromise`, yet `fetchSeasons(title.id)` is not started until line 916, followed serially by `resolveNextHistoryEpisode` at line 924.
  2. **Fallback provider stalls mpv launch waiting for IntroDB/AniSkip**: PlaybackPhase.ts:1457 starts `timingFetch` speculatively for `configuredTimingProviderId`. If a fallback provider wins, PlaybackPhase.ts:2404-2419 **discards `timingFetch` and serially `await`s a brand-new `getPlaybackTimingMetadata` call** before launching mpv — even though `retryTimingInBackground` already knows how to inject skip chapters into a running mpv! (Note: IntroDB timings for TMDB movies/series don't even depend on provider ID; only provider-native anime offsets do.)
  3. **Anime search blocks UI on AniList enrichment & serial lane failover**: SearchRoutingService.ts:233-268 walks anime search providers serially with no hedging, then serially awaits `enrichAnimeSearchResultsWithAniList()` (anime-metadata.ts:43) before returning results to the UI.
  4. **Direct MP4/MKV `probeStreamReachability` runs `HEAD` then `GET` serially** (stream-reachability.ts:318-341): many streaming CDNs return 403/405 to `HEAD`; using `GET` with `Range: bytes=0-0` first avoids a wasted RTT on every direct MP4 stream.
- **Evidence**: Verified at the exact lines cited above.
- **Estimated impact**: **Est. -200 to -1,200 ms** across TMDB series launch, fallback-provider launches, anime search-to-results, and direct MP4 probes.
- **Effort**: **S**
- **Risk**: Low.

---

## 4. Distribution

### Current State Verified

- **Release matrix**: 10 native targets (`linux-{x64,arm64}{,-musl}`, `android-{arm64,x64}`, `darwin-{x64,arm64}`, `windows-{x64,arm64}`) in platform-assets.ts:60-135, shipped as `.tar.gz` / `.zip` with `SHA256SUMS`, `SHA256SUMS.archives`, and GitHub OIDC attestations (`actions/attest@v4` in .github/workflows/release.yml:316).
- **npm**: Thin ~9 KiB Node ESM launcher (npm-launcher.mjs) + 10 `@kitsunekode/kunai-<target>` optional platform packages with npm provenance.
- **Package channel rendering**: scripts/packaging/render-channels.ts and .github/workflows/package-channels.yml already automate Homebrew (`homebrew-tap`), Scoop (`scoop-bucket`), and AUR (`kunai-bin`).
- **Self-installers**: install.sh (2,366 lines) and install.ps1 (2,445 lines) — 4,811 lines total duplicating `apps/cli/src/services/update/native-installer/`.

### Distribution Findings (Beyond Road-to-9.5 W4 Signed `SHA256SUMS`)

#### 4.1 — Switch Release Archives to `.tar.zst` (or Dual `.tar.zst` + `.tar.gz`) and Stream Decompression

- **What**: Every release currently ships `.tar.gz` (`55.36 MiB` for `linux-x64`), and install-latest.ts:228 + release-archive.ts:67 load the **entire 55 MiB archive into RAM** (`new Uint8Array(await Bun.file(stagedArchive).arrayBuffer())`) and run synchronous `gunzipSync` into a second **119 MiB `Uint8Array`** (~180–240 MiB peak RSS). Meanwhile, platform-assets.ts:17-18 hardcodes `MAX_RELEASE_BINARY_BYTES = 128 MiB` and `MAX_RELEASE_ARCHIVE_BYTES = 64 MiB` inside already-shipped updaters, which already forced `bytecode: false` on `windows-x64` (124.6 MiB) and `android-x64` (129.1 MiB) (build-shared.ts:200-204).
- **Evidence**:
  - **Measured** on freshly built `apps/cli/dist/bin/kunai-linux-x64` (`124,549,296 B` / `118.78 MiB`):
    - `gzip -9`: **55.53 MiB** (`58,224,762 B`; `.tar.gz` = **55.36 MiB**)
    - `zstd -19`: **44.45 MiB** (`46,610,015 B`) -> **-11.08 MiB (-20.0%)**
    - `xz -6`: **42.10 MiB** (`44,149,488 B`) -> **-13.43 MiB (-24.2%)**
- **Estimated impact**:
  - Streaming decompression via `zlib.createGunzip()` (or `Bun.zstdDecompress` / `zstd` stream) cuts self-update peak RAM from ~200 MiB to **<16 MiB** (critical on Android/Termux and 512 MiB VPSs).
  - Publishing `.tar.zst` alongside `.tar.gz` (for backward compatibility with older updaters) cuts download bandwidth by **20%** immediately and creates archive headroom without waiting on Bun binary shrinkage.
  - Raise `MAX_RELEASE_BINARY_BYTES` (e.g. `160 MiB`) in the next release so future Bun upgrades don't brick self-update on older installs.
- **Effort**: **M**
- **Risk**: Low (dual-format publishing preserves older `kunai upgrade` clients).

#### 4.2 — Binary Code Signing & OS Trust (macOS Gatekeeper / Apple Silicon + Windows SmartScreen)

- **What**: Road-to-9.5 W4 covers signing `SHA256SUMS` (supply-chain integrity), but **OS-level binary signing** is still missing:
  - install.sh:1815-1828 explicitly documents that macOS arm64 binaries are cross-compiled on Linux and arrive **unsigned**, relying on local `codesign --force --sign -` on the user's Mac (which fails on quarantined browser downloads or managed Macs requiring notarized Developer ID binaries).
  - Windows binaries are unsigned (triggering Windows Defender SmartScreen on every release).
- **Evidence**: install.sh:1815-1828; no `codesign`, `notarytool`, or `signtool` step in .github/workflows/release.yml.
- **Estimated impact**: Eliminates macOS Gatekeeper / SIGKILL failures and Windows SmartScreen warnings; prerequisite for smooth WinGet / Homebrew Cask adoption.
- **Effort**: **M** (requires Apple Developer ID cert + macOS runner for `codesign`/`notarytool`, and Azure Trusted Signing or EV/SignPath cert for Windows).
- **Risk**: Low (CI secret/cost overhead, zero runtime risk).

#### 4.3 — Missing Package Managers & Install-Method Detection (WinGet, Nix, Termux `pkg`) + Channel Polish

- **What**:
  - **Missing channels**: render-channels.ts generates Homebrew, Scoop, and AUR only — no **WinGet** manifest (Windows default package manager), no **Nix flake** (`flake.nix` / `nixpkgs`), and no **Termux** apt repository / `pkg` guide (Termux users currently have to rely on `install.sh` or `npm i -g @kitsunekode/kunai`, and `install.sh` requires `curl`/`tar`/`gzip`).
  - **Missing install-method detection**: install-method.ts:113-130 detects `homebrew`, `scoop`, `aur`, `npm`, `bun-global`, `native`, `source` — no detection for `winget`, `nix` (`/nix/store/`), or Termux `$PREFIX` (`pkg`), risking `kunai upgrade` trying to overwrite a package-manager-owned or read-only `/nix/store` binary.
  - **Channel rough edges**: render-channels.ts:198 sets `depends=('mpv')` as a hard dependency in AUR even for download-only / VLC users; render-channels.ts:110-114 omits `curl-impersonate` / `yt-dlp` hints in Homebrew caveats; and PACKAGING.md:23-28,58,68 has drifted to still claim "18 native files / eight platform packages" even though 10 targets (22 files, including Android) now ship.
- **Evidence**: Exact file/line references above.
- **Estimated impact**: Dramatically lowers install/update friction on Windows (`winget install KitsuneKode.Kunai`), NixOS/macOS (`nix run github:KitsuneKode/kunai`), and Termux, and prevents self-updater collisions.
- **Effort**: **M** (Nix flake + WinGet manifest generator + `install-method.ts` detection).
- **Risk**: Low.

#### 4.4 — Delta Updates (zsync / bsdiff / Runtime-Split Architecture)

- **What**: Every release downloads ~55 MiB (`.tar.gz`) even though **~104 MiB of the 118.78 MiB binary is the identical Bun runtime** when Bun's version hasn't changed between Kunai releases.
- **Evidence**: Measured JS payload is **3.22 MiB** (compressed ~950 KiB) vs **55.36 MiB** archive.
- **Estimated impact**: Publishing a `kunai-<prev>-to-<next>.bsdiff` (or `zsync` `.zsync` control file per target, or a thin native bootstrapper + signed `kunai.js` payload update path) would shrink typical patch updates from **55 MiB -> ~1–3 MiB (-95%)** when Bun doesn't change.
- **Effort**: **L**
- **Risk**: Medium (delta verification must still hash-verify the reconstructed full binary against signed `SHA256SUMS` and fall back to full archive on mismatch).

---

## 5. Best Output from Providers

### Current Architecture Verified

- Production roster in bootstrap-providers.ts:48-69: 11 active providers (`vidlink`, `rivestream`, `vidrock`, `movy`, `videasy`, `hianime`, `miruro`, `allmanga`, `animegg`, `youtube`, `twitch`).
- Cross-provider orchestration in PlaybackResolveService.ts + ProviderCandidatePlanner.ts + provider-engine.ts (supports `balanced` 5 s hedge, `fast-first` 1.5 s hedge, `quality-first` 30 s sequential).
- Health persisted to SQLite (`provider_health`, `provider_endpoint_health`, `title_provider_health`), plus `provider-hotfix-manifest.ts`.

### High-Impact Provider Findings

#### 5.1 — Four Silent No-Ops / Broken Feedback Loops in Provider Health & Ordering

- **What**: Kunai has SQLite tables and ranking logic for cross-session provider health, but four concrete seams are disconnected:
  1. **`medianResolveMs` is never written (0/11 providers)**: provider-ordering.ts:49-51 sorts fallbacks by `medianResolveMs`, and provider-health-observation.ts:69 writes `medianResolveMs: delta.resolveMs` (which also overwrites with a single sample rather than an EWMA/median). A full-repo grep confirmed **zero production providers** ever populate `healthDelta.resolveMs`, and PlaybackResolveService.ts:681-688 never computes it from attempt duration. Latency-based ordering is therefore a **100% silent no-op**.
  2. **`subtitleSuccessRate` and `streamSurvivalRate` are hardcoded `undefined`**: provider-health-observation.ts:73-74. Post-launch startup stalls / dead streams detected in run-mpv-playback-session.ts:153-177 never demote the provider in `providerHealth`.
  3. **A locally `down` primary provider is never bypassed**: ProviderCandidatePlanner.ts:109-112 only filters `compatibleFallbackIds` with `isProviderFallbackEligible`, then unconditionally returns `[input.primaryProviderId, ...orderedFallbacks]`. When the lane default (`vidlink` or `hianime`) is confirmed `down`, every episode play still hits it first and burns `hedgeDelayMs` (5 s in `balanced`, up to 30 s in `quality-first`) before trying a healthy fallback.
  4. **Per-title learned provider preference is explicitly discarded**: `TitleProviderHealthService` persists per-title failures and winning fallbacks in SQLite, PlaybackResolveService.ts:514-531 loads and passes `suggestion`, and ProviderCandidatePlanner.ts:102-104 executes `void input.suggestion;`.
- **Evidence**: Exact lines verified above (this directly violates the repo's `Declaration -> reader` seam rule).
- **Estimated impact**:
  - Computing `resolveMs` in `PlaybackResolveService` using an EWMA/rolling median, recording post-launch `streamSurvivalRate` from `run-mpv-playback-session`, promoting `suggestion.suggestedProviderId` when the title previously failed on primary, and demoting a `down` primary behind healthy fallbacks (with a short probe/recovery cooldown, e.g. 5 min) saves **5–30 s on every affected play** and dramatically improves first-try hit rate across sessions.
- **Effort**: **S–M**
- **Risk**: Low–Med (guard primary demotion with a TTL / half-open probe so a recovered primary is retried automatically rather than permanently banished).

#### 5.2 — Initial Startup Quality Selection Ignores Bitrate, HDR Preference, and Subtitles

- **What**: startup-selection.ts:93-112 (`selectReadyStream`) sorts candidates strictly by `qualityRank` (resolution height integer) with **no tie-breaking** on HLS `bandwidth` (already parsed by hls-ladder.ts:22), codec, `hdrMode` preference (which is only applied during manual source switching in source-quality.ts:504-533, not at startup), or external subtitle availability.
- **Evidence**: Verified at the lines cited above.
- **Estimated impact**: Higher-bitrate / HDR-matched / subtitled 1080p streams chosen on the first try instead of low-bitrate re-encodes or sub-less variants at the same resolution height.
- **Effort**: **S**
- **Risk**: Low.

#### 5.3 — No Cross-Session CDN/Host Cooldown Persistence & Single-Point-of-Failure Default Provider

- **What**:
  - ProviderEndpointHealthService.ts:78-81 stores `transientCooldowns` (timeouts, 429s, 5xx) only in an in-memory `Map`, and resolve-gate.ts:142 tracks `refusedHosts` only inside a single resolve call — dead CDN hosts are retried from scratch on the next episode or session.
  - Default TMDB provider (`vidlink`, defaults.ts:41-48) depends on third-party `enc-dec.app` (vidlink/direct.ts:36-47) as a hard upstream dependency, and `balanced` mode waits **5 full seconds** (provider-resolve-budget-policy.ts) before hedging to `rivestream`/`vidrock` if `enc-dec.app` is slow. Lowering `balanced` hedge delay from 5 s -> 2.5–3 s (or using adaptive EWMA p75 of the primary provider's `resolveMs`) lets healthy fallbacks rescue slow primaries much sooner without spamming providers on fast hits.
  - Lane default inconsistency: defaults.ts:88-90 sets `movieLanguageProfile.subtitle = "en"` and `animeLanguageProfile.subtitle = "en"`, but `seriesLanguageProfile.subtitle = "none"` — worth confirming whether intentional or an oversight for non-English series.
- **Evidence**: Exact lines cited above. (Note: `provider-hotfix-manifest.ts` being inert without env vars is already tracked in road-to-9.5 Maintainer step 2.)
- **Estimated impact**: Eliminates repeated timeouts against dead CDN edges across episodes/sessions; cuts tail latency on `vidlink`/`enc-dec.app` slowdowns by **2–2.5 s** on `balanced`.
- **Effort**: **S–M**
- **Risk**: Low (use short TTLs — e.g. 10–15 min — for persisted CDN host cooldowns so recovered edges re-enter automatically).

---

## 6. Features and Gaps (Ranked, Beyond Road-to-9.5)

1. **Startup Milestone Instrumentation Gap (High leverage for enforcing plan 060)** — **Effort: S | Risk: Low**
   - _What / Evidence_: cli-startup-milestone.ts:5-6 only records `"shell-module-loaded"` and `"shell-mounted"`. When running `--debug` in our PTY test, `shell-module-loaded` fired at `189 ms` with `lazyImportMs: 14 ms` — leaving the other **175 ms** completely unattributed in logs. Adding milestones for `graphics-probe-done`, `deps-checked`, `db-migrated`, `vault-ready`, and `container-ready` makes startup regressions immediately diagnosable in `--support-bundle` and CI.
2. **Release Binary & Bundle Budget Headroom Crisis** — **Effort: S | Risk: Low**
   - _What / Evidence_: `dist/kunai.js` sits **80 bytes** below `NPM_BUNDLE_BUDGET_KB = 3_135` (build-shared.ts:453), and `kunai-linux-x64` sits **5.22 MiB** below the `124 MiB` target / **9.22 MiB** below the hardcoded `128 MiB` updater cap. Landing Findings 2.1–2.3 now prevents every subsequent PR from tripping the build gate or triggering yet another budget bump.
3. **Progressive Anime Search (Non-Blocking AniList Enrichment + Hedged Provider Search)** — **Effort: M | Risk: Low**
   - _What / Evidence_: SearchRoutingService.ts:233-268 blocks displaying anime search results until both serial provider failover and AniList GraphQL enrichment complete. Rendering provider hits immediately and streaming poster/synopsis/AniList ID enrichment into state makes anime search feel instantaneous.
4. **Desktop VLC Support Parity** — **Effort: M–L | Risk: Medium**
   - _What / Evidence_: `--player vlc` is advertised in cli-args.ts:110 (`auto|mpv|vlc`), but player-choice.ts:54-56 rejects it on Linux/macOS/Windows (`{ kind: "unsupported", choice: "vlc" }`). Road-to-9.5 W6 notes fixing the help text; longer-term, desktop VLC (or IINA on macOS) via VLC's HTTP/RC interface would unlock users who cannot or do not want to install `mpv` (especially on Windows/macOS).
5. **Move `jpeg-js` to `devDependencies` & Sync `PACKAGING.md` (18 -> 22 files)** — **Effort: S | Risk: Low**
   - _What / Evidence_: `jpeg-js` in apps/cli/package.json:137 is only imported by tests (`test/support/image-fixtures.ts:7`); PACKAGING.md:23-28,58,68 still documents 8 targets / 18 files instead of the live 10 targets / 22 files.
