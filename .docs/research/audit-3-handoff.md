---
status: current
lastReviewed: "2026-09-26"
---

# Audit 3 — Handoff for fix agents

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Base: `main@51f19b633`. Date: 2026-09-26. Findings filed as issues **#447–#474**.

This is the single place to pick up work from a full-tree audit that combined
**static reading** with **actually running the product** (a cache-busted gate
run, the compiled binary, the real installers, and one-shot provider liveness
probes). Every finding below carries `file:line`, the check that would have
falsified it, and the test that does or does not cover it.

## How to use this file

1. Pick a row. Check the issue for the full body — this file is the index, the
   issue is the spec.
2. **Do not re-file anything in [Verified clean](#verified-clean-do-not-re-audit).**
   Roughly a third of audit findings in this repo have historically dissolved
   when someone opened the twenty lines around the cited one. Those already
   dissolved; they are listed so they are not re-derived.
3. Read `.docs/agents/audit-findings-bar.md` before you file anything new. It is
   the bar your reviewer will hold you to.
4. When you fix something, close the row here and update the issue. If a fix
   invalidates another row, say so in the PR body — several of these interact.

### Ground rules that produced most of these findings

- **Isolation.** `KUNAI_CONFIG_DIR` is **not** an override. Use
  `storageRootEnv` (sets `HOME` + `XDG_*` + `APPDATA`) or a scratch dir under
  `/tmp`. Never point a test or a debug run at the live SQLite databases.
- **A green gate is not proof.** `bun run test` was run with `--force` for this
  audit: **52/52 tasks, 0 cached, 1m42s.** `main` is green. The breakage is
  behavioural, not a failing build.
- **Hit every seam.** A behaviour reachable from browse is usually also reachable
  from the palette, a hotkey, and post-play. Several rows below are one-line
  fixes that are only correct if all four entry points are checked.

### Severity used here

|        |                                                                |
| ------ | -------------------------------------------------------------- |
| **P0** | data loss, secret exposure, or a shipped promise that is false |
| **P1** | a user-visible lie or a dead default path                      |
| **P2** | wrong behaviour on a reachable input                           |
| **P3** | latent, or a comment/contract that no longer matches the code  |

---

# A. Fix first — reproduced by running the product

These were executed, not inferred. Each is a small, isolated diff.

| #   | Issue | Sev    | What is broken                                                                                                                 | Primary site                                     |
| --- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| A1  | #447  | P1     | `kunai` without a TTY crashes with a React stack trace, printed 3×, leaking absolute paths                                     | `main.ts:1247`                                   |
| A2  | #448  | P1     | Any unknown subcommand **becomes a search**; an unknown flag exits 0; `--config <path>` is swallowed as the search query       | `cli-args.ts:107-115`, `:288-303`                |
| A3  | #449  | P1     | `-i/--id` validates nothing — `abc`, `0`, `-5`, `anilist:` all yield a success plan                                            | `bootstrap-intent.ts`                            |
| A4  | #450  | **P0** | A corrupt `config.json` overwrites its own `.bak` on every run, and the "reset to defaults" warning never rewrites the file    | `FileStorage.ts:76`, `:80-84`                    |
| A5  | #451  | P1     | A read-only config dir hard-crashes at launch with an un-redacted absolute path — while `doctor` diagnoses it correctly        | `ui.ts:104` ← `ui.ts:249` ← `main.ts:785`        |
| A6  | #452  | P1     | `doctor` exits **0** with every dependency missing; the remediation line renders as `openSUSEsudo zypper install mpv`          | `run-doctor.ts:26`, `install-commands.ts:82`     |
| A7  | #456  | P2     | A NUL byte makes `offline-title-identity.ts` binary to grep and lint                                                           | `services/offline/offline-title-identity.ts:70`  |
| A8  | #471  | P2     | `verify:readme-commands` exits 2 on every invocation — the root script passes no arguments                                     | `package.json:112`                               |
| A9  | #466  | P2     | `truncateAtWord` returns strings **wider** than its budget for any CJK/emoji prefix (measured: budget 20 → 33 cols)            | `domain/text-display.ts:98-103`                  |
| A10 | #465  | P2     | The playback failure panel silently truncates the one sentence that says what failed                                           | `root-status-shells.tsx:139-152`, `:238`, `:245` |
| A11 | #455  | P3     | `install.sh --help` fails under the documented `bash -s --` route                                                              | `install.sh:2192-2197`                           |
| A12 | —     | P3     | `doctor` inspects the **real** `PATH` even with `HOME`/`XDG_*` fully redirected                                                | `run-doctor.ts`                                  |
| A13 | —     | P3     | `diagnostics recent` on an empty cache DB prints nothing, exit 0; `--format bogus` silently falls back; `--limit abc` accepted | `diagnostics-export.ts:25-35`                    |
| A14 | —     | P3     | `upgrade --check` splits its output: `Info:`/`Error:` → stdout, the failure line → stderr                                      | —                                                |
| A15 | —     | P3     | `--download` with no target opens the shell; in a pty it only complains at quit, contradicting `--help`                        | `main.ts:402-416`, `:473`                        |

### A4 deserves a note

The SQLite path already does this correctly — a corrupt DB is quarantined to a
**timestamped, non-clobbering** `.bak` and the user gets a clear warning. The
config path is the only outlier. Reusing the existing helper is the whole fix.

---

# B. Providers — measured against live hosts

Liveness probed 2026-09-26 with 1–2 requests per host, no retries, no scraping.

| Host                                                                                                                                                    | Result          | Note                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `anidb.app`, `hls.anidb.app`                                                                                                                            | **HTTP 503**    | `anidb` is the **default anime provider** (`defaults.ts:29`)                                  |
| `api.videasy.to`                                                                                                                                        | **NXDOMAIN**    | `VIDEASY_DB_BASE`; the call at `videasy/direct.ts:2324-2340` swallows it to `null` every time |
| `api.mkissa.net`                                                                                                                                        | **403** CF      | allmanga crypto bootstrap (`allmanga/crypto.ts:39`)                                           |
| `api.speedracelight.com`                                                                                                                                | **200, 0.365s** | **recovered** — the row in #422 is stale                                                      |
| `allmanga.to`, `mkissa.to`, `zokoanime.video`, `miruro.bz`, `miruro.ru`, `kwik.cx`, `vidlink.pro`, `enc-dec.app`, `rivestream.app`, `player.videasy.to` | **200**         | healthy                                                                                       |

| #   | Issue | Sev | Finding                                                                                                                                                                                                                               | Primary site                                                                                 |
| --- | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| B1  | #457  | P1  | AniDB marks a Cloudflare block `retryable: true` **after** both transports are spent — buying a second 12s attempt on a request that cannot succeed                                                                                   | `anidb/direct.ts:605-613`                                                                    |
| B2  | #458  | P1  | `ProviderHttpError` is thrown by **1 of 8** production providers, so a 429 or a CF-less 403 classifies as retryable `network-error` → `transient` → **never reaches endpoint quarantine**                                             | `runtime/fetch.ts:122-129`                                                                   |
| B3  | #459  | P1  | The resolve gate is unreachable for **6 of 8** providers; miruro declares a probe with **zero constructors**; the mpv preflight waives the gate for streams younger than 5 min, so episode→episode autoplay hands mpv an unprobed URL | `direct-stream-source.ts:199`, `miruro/direct.ts:218`, `PersistentMpvSession.ts:416-420`     |
| B4  | #460  | P1  | hianime's relay-backed fetch **falls back to a direct upstream request**; and hianime is absent from the user's relay toggle while an absent key defaults to `true`, so it is permanently relay-routed                                | `hianime/client.ts:201-215`, `provider-relay-settings.ts:7-14`, `resolve-relay-config.ts:39` |
| B5  | #461  | P1  | The 3-lane predicate is re-derived as a two-way boolean in 3 places, so the YouTube lane offers **and persists** series providers                                                                                                     | `session-flow.ts:219`, `playback-mount-shell.tsx:443`, `provider-health-reset.ts:132`        |
| B6  | #462  | P2  | `NETWORK_ERROR_PATTERNS` matches the **bare substring `"dns"`**; two such failures across distinct providers halt every remaining live candidate                                                                                      | `NetworkStatus.ts:25-37`                                                                     |
| B7  | #463  | P1  | `videasy` is the shipped default while its metadata host is NXDOMAIN; `providerPriority` never names it, so the "videasy first" comment is not what the code expresses                                                                | `defaults.ts:26`, `:31`                                                                      |
| B8  | #464  | P1  | An empty result is indistinguishable from an outage; the anime lane's `provider.search` has **no try/catch and no fallthrough**                                                                                                       | `browse-shell.tsx:2071-2077`, `SearchRoutingService.ts:178-219`                              |

**B2 is the highest fan-out-per-line change in the provider layer**: one typed
error per provider unlocks correct retry, correct health deltas, and quarantine
for all eight at once. `allmanga` (`direct.ts:809`) and `hianime`
(`direct.ts:289-292`) already show the correct per-failure-class policy.

### B3's shape, precisely

`runStreamHealthCheck({phase:"resolve-gate"})` is reachable only from
`shared/direct-stream-source.ts:199` (vidlink, rgshows, vidrock) and
`videasy/direct.ts:1334`. Not from allmanga, hianime, anidb, rivestream. miruro
_declares_ `streamReachabilityProbe` (`direct.ts:218,279,467`) and nothing
constructs it. `miruro-direct.test.ts:96-100` asserts
`streamReachabilityVerified === true` **by injecting the probe by hand** — which
is exactly why the missing producer survived review.

---

# C. Tests and gates — green while proving nothing

| #   | Issue | Sev | Finding                                                                                                                                                                                                                                                                                                                           |
| --- | ----- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | #467  | P1  | The four "always" CI jobs run **zero tasks** for a PR touching no workspace package (`--affected` + empty diff → `"tasks": []`, exit 0). `install.sh`, `.github/**`, `docs/**`, `tools/**` PRs get four green no-ops. `typecheck` is also the only cacheable task in the blocking chain. `.husky/pre-push` is `bun run test` only |
| C2  | #468  | P1  | 10 tests gated on `yt-dlp` with **no CI leg installing yt-dlp**; `anime-discovery-resolve-handoff` needs `KUNAI_LIVE_PROVIDER_TESTS` which **no workflow sets**; 14 compiled-binary smokes are release-only; 13 of 13 individual live provider smokes are unwired; the vhs tapes write _into_ their own golden path               |
| C3  | #469  | P2  | 90 golden-capture files are read from disk and never re-rendered; the width parser is test-local; the harness's `countCommits` flicker probe has zero callers                                                                                                                                                                     |
| C4  | #470  | P2  | `turbo run fmt:check` never sees root files: 18 `.yml` (incl. every workflow), `turbo.json`, `.oxlintrc.json`. `verify:doc-coverage` passes on substring matching (24 of 71 dirs match only prose). `verify:build-pipeline` step 4 asserts cache hits the run just created                                                        |
| C5  | #472  | P2  | `lint:anti-slop` is **5,427 errors** on `main` (362 in shipped `apps/cli/src`), not gated, not baselined — and `.docs/lint-policy.md` describes a ratchet no code implements. **Needs a decision, not a chore**                                                                                                                   |
| C6  | —     | P2  | `test:future`, the 180-day time-rot detector that has already caught three real bugs, runs in **no gate** (`apps/cli/package.json:54`; 55 date-literal seeds, 6 `Date.now` patch files)                                                                                                                                           |
| C7  | —     | P2  | 97 raw sleeps across 43 test files; only 12 use the sanctioned `wait-until.ts`                                                                                                                                                                                                                                                    |
| C8  | —     | P2  | `test-timeout-budget.test.ts:19` enforces a 20,000 ms floor citing _"16549 ms on the next run"_ — the suite answered a 16s unit test by raising the ceiling                                                                                                                                                                       |
| C9  | —     | P3  | `BinaryAutoUpdater.test.ts:20` — _"clears the background interval and is idempotent"_ with **zero `expect()`**                                                                                                                                                                                                                    |
| C10 | —     | P3  | `packages/core/test/core.test.ts:21-242` asserts against **test-local copies** of provider manifests; nothing validates the real allmanga/vidking/rivestream manifests                                                                                                                                                            |
| C11 | —     | P3  | `install-scripts-pwsh.test.ts:1919` registers a _passing placeholder_ asserting `pwshAvailable() === false`; `:2661` is skipped on every leg                                                                                                                                                                                      |
| C12 | —     | P3  | `npm-launcher.test.ts:208-222` asserts `Bun.which` against a locally built `PATH` — it tests Bun, not kunai                                                                                                                                                                                                                       |

**Counts:** 900 test files · 44 explicit skip sites (17 platform, 10 tool, 4 env)
· **+10 silent guards that report green** · 0 `.only` · 0 `.todo` · 0 snapshots.

**The pattern to copy, not to invent:** `ci.yml:255-262` fails the Postgres job
on any skip line, and `ci.yml:526-527` greps for a `pwsh` skip line. Every row in
C2 is missing exactly that property.

---

# D. Distribution

| #   | Issue | Sev | Finding                                                                                                                                                                                                                                                                                                                                          |
| --- | ----- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | #454  | P1  | **Neither installer detects root/elevated.** `sudo install.sh` installs to `/root/.local/bin` and writes `/root/.bashrc`, prints `Done.`, and the user never gets `kunai` on PATH. The update channel reads _that_ profile's `install.json`, so `kunai upgrade` and the notifier never see it either. Zero hits for `EUID`/`SUDO_USER`/`IsAdmin` |
| D2  | #453  | P1  | `install.sh` reads **neither** documented env var (`KUNAI_INSTALL_YES`, `KUNAI_SKIP_DEPS`). Plan 061.3 states the parity **backwards** — its Step-3 test would encode the error. It also misses a second gap: `install.ps1:43` hardcodes `$Package`, so a fork's `-Method npm` installs upstream                                                 |
| D3  | —     | P2  | `apps/cli/package.json` is publishable-shaped (`bin: dist/kunai.mjs`, `dependencies`, `publishConfig.access: public`) and contradicts the real `dist/npm/package.json`. `verify-npm-pack.ts` validates only `dist/npm`, so the exact command `RELEASING.md:73` forbids in prose fails no gate                                                    |
| D4  | —     | P2  | `PACKAGING.md:33-36` and `RELEASING.md:207-212` both say `cd apps/cli && bun pm pack`, but root `package.json:129` packs `apps/cli/dist/npm`. Two packers (`bun pm pack` vs `npm pack`) for one preserved artifact                                                                                                                               |
| D5  | —     | P2  | Plan 061.2 open: `install.ps1:2410` gates optional-dep guidance on `-Method binary`, so a Windows npm user gets no mpv guidance. `install.sh:2260` runs it unconditionally                                                                                                                                                                       |
| D6  | —     | P3  | Windows gets an "Experimental" binary with no warning (`:232-236`) while the same script warns for a _helper_ (`:1856`)                                                                                                                                                                                                                          |
| D7  | —     | P3  | `install.sh --help` aside (A11): `install` and `awk` have no `require` guard, unlike `curl`/`gzip`/`tar`/`od`                                                                                                                                                                                                                                    |
| D8  | —     | P3  | Windows launcher ownership depends on `install.json` + `artifactSha256`; a lost manifest makes `kunai uninstall` return `blocked([...])` with paths and **no manual remedy**                                                                                                                                                                     |

**Installer parity, verified by extracting both seam sets:**

|                     | install.sh                                                                                                                                                   | install.ps1                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sh-only seams (8)   | `KUNAI_REPO`, `KUNAI_PACKAGE`, `KUNAI_INSTALL_DIR`, `KUNAI_ARCHIVE_TAR_COMMAND`, `KUNAI_DOWNLOAD_SPEED_LIMIT`, `KUNAI_DOWNLOAD_SPEED_TIME`, + 2 `PATH_BLOCK` | —                                                                                                                                                                                                  |
| ps1-only seams (10) | —                                                                                                                                                            | `KUNAI_SKIP_DEPS`, `KUNAI_INSTALL_METHOD`, `KUNAI_INSTALL_VERSION`, `KUNAI_INSTALL_YES`, `KUNAI_INSTALL_DRY_RUN`, `KUNAI_DOWNLOAD_STALL_MS`, `KUNAI_YTDLP_RELEASE_BASE`, + 3 curl-impersonate pins |
| launcher form       | symlink                                                                                                                                                      | full copy                                                                                                                                                                                          |
| optional deps       | all methods                                                                                                                                                  | binary only                                                                                                                                                                                        |

**Genuinely strong, protect it:** checksum verification is real and fail-closed
in all three languages; archive traversal/links/duplicates rejected in both; the
installer never pipes a download to a shell; sudo is opt-in with the exact
command printed and fails closed without a tty; the release sequence is
workflow-enforced, and the publish job re-pins `HEAD == origin/main` and
re-verifies provenance at four boundaries. **Hazard #4 is respected** —
`providerRelay.baseUrl` is `""` and `build-shared.ts:87` sets
`env: "disable"`, so no shared host is frozen into an immutable binary.

---

# E. Performance — measured, with the numbers in the issue

| Finding                                                                                                                                                        | Cost                                                                                       | Where                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| The graphics probe is a **serial `await`** in front of everything (400 ms on win32, 100 ms elsewhere)                                                          | up to **40%** of a 150-160 ms pre-paint budget                                             | `main.ts:782-783`, `image/probe.ts:73-77` |
| All 8 provider modules are already evaluated before `main()` via the `@/ui` barrel — each later `import()` is **0 ms**, so lazy loading currently wins nothing | ~35 ms ceiling; **unblocks plan 006**                                                      | `main.ts:73` → `ui.ts:15`                 |
| Migration DDL is synchronous and **scales with history size** — `CREATE INDEX` on a 200k-row table measured 151 ms then 84 ms                                  | 298 ms fresh; **0.34–0.6 s** on the first launch after a release that adds history indexes | `bootstrap-persistence.ts:220-245`        |
| Five unbounded process-global caches (#445 did not sweep these): `epCache` holds ~1,100 episode rows for one show                                              | unbounded heap for the session                                                             | `tmdb.ts:45-47`, `aniskip.ts:40-42`       |
| No concurrency ceiling on poster fetch + native prepare (repo's own figure: ~14 ms/poster)                                                                     | 280–560 ms off the first frame                                                             | `app-shell/image-pane.ts:203+`            |
| `logs.txt`: unbounded, one sync open/write/**close** per line, `warn` unconditional                                                                            | main-thread IO; 445 KB in this checkout                                                    | `StructuredLogger.ts:90-99`               |
| HLS relay redirect-budget error interpolates the total limit while checking the cumulative remainder — wrong number from hop 2                                 | wrong diagnostic                                                                           | `hls-relay.ts:155-157`                    |

**Do not re-derive these as wins:** PR #444 is correct and tested, and
`orderProviderModulesByPriority` is **13.18 µs** against a 6–12 s resolve. Ship
it as hygiene. `checkpointWal` is dead configuration (both call sites pass
`false`). There are **zero** `ETag`/`If-Modified-Since` uses in the tree.

---

# F. Architecture

| #   | Issue | Sev | Finding                                                                                                                                                                                                                                                                                                                          |
| --- | ----- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | #474  | P2  | **Eleven declarations with no production reader** — including `provider-resolve-retry.ts` (169 lines, 3 tests, 0 callers) and a user-facing string that can never render. Grouped in the issue; each row is independently fixable                                                                                                |
| F2  | —     | P1  | Plan 010's BLOCKED reason is **verifiably false** — `test/support/container-fixture.ts` and `test/harness/render-capture.ts` both exist, which is plan 010's own STOP condition. Meanwhile `PlaybackPhase.ts` grew 3,635→**4,496** and `root-overlay-shell.tsx` 1,945→**2,343** while blocked. Unblocks 011/012/013 for S effort |
| F3  | —     | P2  | Plan 014 is stale in both directions: all three inversions it names are fixed; the real residue is 10 unowned `domain → services` edges plus 3 unowned app→app-shell bridges (all three are baselined DEBT)                                                                                                                      |
| F4  | —     | P2  | `cli-args.ts` keeps a hand-written `KNOWN_FLAGS`/`VALUE_FLAGS` mirror of the Commander declaration; a flag missing from the list is **silently discarded**. `createCliCommand` is not exported, so no test can compare them                                                                                                      |
| F5  | —     | P2  | Three error models coexist: `failureClass` (271 refs, the live one), `KitsuneError` (11 refs), 17 ad-hoc subclasses                                                                                                                                                                                                              |
| F6  | —     | P2  | `ProviderLane` is declared twice with no re-export — already tracked at `roadmap.md:89`. `MediaKind` is **not** duplicated (roadmap row 89 is correct on that)                                                                                                                                                                   |
| F7  | —     | P2  | 20 module-level `let` singletons in `app-shell`; the 3 cross-boundary ones form an unowned channel with no plan                                                                                                                                                                                                                  |
| F8  | —     | P3  | `openBrowseShell` takes **29 named parameters** at `browse-shell.tsx:2274-2341`                                                                                                                                                                                                                                                  |
| F9  | —     | P3  | `ImageProtocol` is declared as a stringly-typed union **four times**                                                                                                                                                                                                                                                             |
| F10 | —     | P3  | Plan status vocabulary is unenforced — `roadmap.md:174` declares 4 values; the files use 7+                                                                                                                                                                                                                                      |
| F11 | —     | P3  | `isEphemeralKunaiLuaScript` can never return true (its marker string exists nowhere in the tree, including `.archive`), so `cleanupLuaScript` is a no-op — **and** it deletes a _user's_ file if they point `mpvKunaiScriptPath` at a matching tmpdir path. Row 2-adjacent in #474; verify before/with that fix                  |

### Extensibility scorecard (concrete file counts)

| Change                 | Cost                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Add a provider         | **22 files**, but 8 are declarative list insertions and the docs tables are generated. **Best seam in the repo.**                        |
| Add a download backend | **~8–10 + a migration.** No interface exists, `executeYtDlpDownload` is private, `download_jobs` has no backend column. **Worst score.** |
| Add a CLI flag         | 6 sites in one file + 2 elsewhere — and see F4                                                                                           |
| Add an image protocol  | 4 declarations + a renderer + a MIME branch + settings + smokes                                                                          |

---

# G. Repo hygiene

| #   | Issue | Finding                                                                                                                                                                                     |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | #473  | `.release-candidate/` (**268 MB**) and `.delta/` (5.3 MB) are **neither tracked nor ignored** → `git add -A` stages them. Add to `.gitignore`                                               |
| G2  | #473  | 5.4 GB of worktrees inside the repo (`.worktrees/` 4.0 GB, `.claude/worktrees/` 1.4 GB) on a volume that was **95% full**. `bun install` state is duplicated, not shared. Prune or relocate |
| G3  | —     | `git status` at audit time: 1 modified + 21 untracked, all pre-existing. Nothing below is from this audit                                                                                   |

**Checked and _not_ problems** (recorded so nobody re-checks): tooling does not
traverse the worktrees (oxlint reports 2182 files with and without
`--no-ignore`; dot-dirs are skipped); test globs cannot escape the package; root
clutter (`logs.txt`, `stream_cache.json`, the diagnostics report, `artifacts/`,
`.turbo/`, `apps/cli/dist/`) is all correctly gitignored.

---

# H. Unfiled backlog

Real, verified, deliberately **not** filed as issues — either too small to
deserve a number or already owned. Take them from here.

| Finding                                                                                                                                                                                                                        | Site                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `mergeArchivedPastWindow`'s comment says the window is `+7d`; the code uses `now + (7+1)` = **+8d**, and nothing pins either bound                                                                                             | `app/search/calendar-results.ts:349-354`                                       |
| `parseInt` without a radix, and a `?? "0"` that cannot fire (a value of `"audio:"` yields `""`, which is not nullish) → `id: NaN` on the mpv track-id path                                                                     | `persistent-mpv-property-router.ts:168`, `:174`                                |
| mpv stream header keys matched **case-sensitively** on one line and case-insensitively 10 lines later; a `USER-AGENT` or `Referrer` producer is dropped from both paths                                                        | `mpv-stream-http-headers.ts:45-47` vs `:55`                                    |
| `as never` in a live production path (and an `as unknown as` before it) — both casts look **unnecessary**; the types are structurally compatible                                                                               | `PlaybackPhase.ts:4290-4292`                                                   |
| Two byte-identical ~50-line blocks: same regex, same numeric extractor, same guard, same `normalizeTitle`, same 3-tier match ladder. A `>` vs `>=` divergence would be invisible                                               | `hianime/parsers.ts:39` vs `anidb/browse-parser.ts:36`                         |
| Two language tables of different sizes for one job (23 vs ~35 entries), one of them a fresh object literal allocated **inside** a per-hint function                                                                            | `subtitle.ts:46` vs `shared/subtitle-helpers.ts:101`                           |
| `musl.ts:20-25` reads the whole running binary into memory and discards it, under a comment saying that is the wrong approach                                                                                                  | `services/update/native-installer/musl.ts:20-25`                               |
| `isEphemeralKunaiLuaScript` + `cleanupLuaScript` — see F11                                                                                                                                                                     | `infra/player/kunai-mpv-bridge.ts:91-95`                                       |
| Dead `??` arm: `currentBandwidth` is a `number`, never nullish, so `?? 0` is unreachable                                                                                                                                       | `shared/hls-ladder.ts:82,91,112-113`                                           |
| `if (!Number.isFinite(version)) return null` is unreachable — `rawVersion` is `\d+`                                                                                                                                            | `shared/curl-impersonate.ts:78-79`                                             |
| `parseIpv6` omits the `octet < 0` check its sibling `isPublicIpv4` has. **Not exploitable** (the regex cannot match a signed octet, and a slipped negative yields `"-fc"`, which the group check rejects) — symmetry only      | `packages/relay/src/pinned-transport.ts:495`                                   |
| `NETWORK_ERROR_PATTERNS`-adjacent: truthiness on a season number is the only thing keeping S0 specials out of "previous season", and the guard is inert because `tmdb.ts:205` already filters                                  | `domain/playback/playback-policy.ts:302,316`                                   |
| `looksLikeHostname` requires a dot, so a single-label host is never redacted as a hostname                                                                                                                                     | `services/diagnostics/bundle-redaction.ts:199`                                 |
| `apps/cli/src/app-shell/root-overlay-shell.tsx` vs the F7 bridges: `container.analyticsDisclosurePending` has three writers across three layers and is read non-reactively                                                     | `main.ts:978`, `ink-shell.tsx:423`                                             |
| Security, from the first pass: `logs.txt` carries media titles and home-relative paths with the secrets-only redactor, while the **support bundle** uses a stricter one that strips exactly those keys. No `0o600` on creation | `StructuredLogger.ts:101`, `redaction.ts:26-41` vs `bundle-redaction.ts:21-36` |
| Security: the docs site runs a second collector (`@vercel/analytics/next`) that neither the L3 contract nor `docs/users/reliability-and-privacy.mdx` discloses, while `share-links.mdx:9` documents the share-page _exclusion_ | `apps/docs/components/analytics/privacy-analytics.tsx:4-8`                     |
| Security: no enforcing test for hazard #4 — every `baseUrl: ""` in the test tree is a test _input_ that spreads `DEFAULT_CONFIG`, so all keep passing against a non-empty default. Copy the analytics `endpoint-pin` pattern   | `packages/config/src/defaults.ts:80`                                           |
| Security: atomic-write temp file opened without `O_EXCL`/`O_NOFOLLOW` on a `pid`+`Math.random()` name (needs write access to your own config dir; secrets are `0600` at creation)                                              | `atomic-write.ts:159`                                                          |
| Docs drift: `.docs/architecture.md:189` documents `~/.config/kunai/config.json` while AGENTS.md says never hardcode it and `paths.ts:109-130` resolves per platform — **two current docs contradict each other**               | `.docs/architecture.md:65,189`                                                 |
| Docs drift: `.docs/keybindings.md` browse/loading/post-play tables disagree with the live registry in both directions                                                                                                          | `.docs/keybindings.md:46-151`                                                  |
| Docs drift: `/play-local` and `/watch-online` are documented as a file picker and an offline toggle; both are per-episode source switches                                                                                      | `docs/users/commands-and-shortcuts.mdx:31-32`                                  |
| `zenMode` / `minimalMode` are listed as settings beside registry-backed rows, but no settings-registry row exists — only the `--zen`/`--minimal` flags or a manual JSON write                                                  | `docs/users/customization.mdx:126-127`                                         |
| `.plans/011-015` and `phase-1.8` quote line counts that are >20% wrong, and name `workflows.ts` (a 1-line re-export) as "~1k lines"                                                                                            | `.plans/`                                                                      |
| `verify:doc-coverage`'s `isRouted()` is a substring test, so a directory named in any sentence counts as routed (24 of 71)                                                                                                     | `scripts/verify-doc-coverage.ts`                                               |

---

# I. PR queue — 98 open, 66,045 additions, 1,370 files

Not code findings, but the largest single risk in the repo.

- **Close as zero-unique-content:** #346 (77/77 files covered by [#345,#340,#337,#329,#326,#350,#351,#353]), #345 (48/48 covered by [#347,#348,#349,#351,#340]), #399 (49/50 covered by 10 still-open PRs). 9,198 additions of re-landed work. **Reduce #400 to its 12 unique player/timing files.**
- **Superseded:** #348 (pins mkissa build 166; #394 corrects it to 171), #429 (contradicts #433/#434 _and_ `AGENTS.md`: _"a test that needs a timeout to pass is wrong"_ — needs an author decision, not a rebase), #255 (author-marked hold), #5 (10-line `AGENTS.md` append, DIRTY, red).
- **"Green" is not a signal here:** #439 (3,714 lines, 50 files) ran **7 checks — no Test, no Typecheck, no Lint, no Build.** Four of the eight "red" PRs are `CANCELLED`, not failed.
- **Merge train:** Wave 0 close the three dead PRs → Wave 1 the 20-PR file-disjoint set → Wave 2 CI foundation (#380 → #407 → #429 resolved) → Wave 3 the resolve-gate stack (#347→#348→#349→#350→#351→#353; `verifyCandidateStream` does not exist on `main`, so **exactly one** implementation may land) → Wave 4 the anime/mirror stack → Wave 5 plans 048–067 **one at a time** (23 PRs touch `.plans/roadmap.md`) → **#327 last, regenerated, not merged as-is.**
- **Do not merge yet:** #327 (version PR stages notes for unlanded work), #419 (see the PR comment), #439 (no native CI), #440 (lint red, self-referential baseline), #287 (DRAFT, 100 files, rewrites `release.yml` + `build-binaries.yml` + `install.sh`), #306 (Chromecast, 4,468 lines, DIRTY, no roadmap row), #365 (cites a plan file that does not exist).
- **Release-path edits with no release gate having judged them:** #287, #407, #397, #440.
- Plans 059, 060, 061, 062, 064, 065, 066, 067 have **no PR at all** while indexed as active work in the roadmap.

---

# J. Corrections to earlier reports in this audit

Recorded so nobody re-derives them.

| Earlier claim                                            | Correction                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "videasy is the default and its upstream is dead"        | **Too strong.** The _metadata_ base (`api.videasy.to`) is NXDOMAIN; the _stream_ base (`api.speedracelight.com`) is **HTTP 200**. The real user-visible problem is AniDB 503 (the default **anime** provider) plus a permanently failing metadata call that returns `null`. → #463 |
| "the NUL byte affects the worktree copies"               | **Refuted.** Exactly 1 NUL in `main`'s copy; all 79 worktree copies are clean. → #456                                                                                                                                                                                              |
| "`.worktrees` may be traversed by lint or tests"         | **Refuted.** oxlint reports 2182 files identically with and without `--no-ignore`; dot-dirs are skipped. It is a disk-space hazard, not a tooling one. → #473                                                                                                                      |
| "root clutter may be tracked"                            | **Refuted.** `logs.txt`, `stream_cache.json`, the diagnostics report, `artifacts/`, `.turbo/`, `apps/cli/dist/` are all correctly ignored. Only `.release-candidate/` and `.delta/` are not. → #473                                                                                |
| "`verify:doc-coverage` does not run locally" (AGENTS.md) | **Refuted.** It runs and passes. AGENTS.md's own hazard-2 bullet is wrong. → #470                                                                                                                                                                                                  |

---

# K. Verified clean — do not re-audit

Each was checked by execution or by opening the callee, and **dissolved or
confirmed sound**. Re-filing any of these wastes a review cycle.

- **Type safety is exceptional.** 963 production files: 0 `@ts-nocheck`, 0
  `@ts-ignore`, 0 `@ts-expect-error`, 0 `as any`, 0 `any` in a production
  signature, 0 unsafe non-null assertions on I/O. All 12 tsconfigs have `strict`
  **and** `noUncheckedIndexedAccess`.
- **Dependency health.** `bun audit` → 14 advisories, **all dev-only**, all
  absent from the 80 MiB binary (grepped). The lockfile has zero git/http/file/
  tarball specifiers, zero forks, zero dist-tags. The package graph is acyclic
  and correctly layered. **Zero version drift** across 8 artifacts.
- **Supply chain, spot-checked and sound:** the HLS relay SSRF gate (exact apex
  matching, per-hop revalidation, https→http refusal, byte budgets);
  release-archive extraction (refuses paths, links, extra members, size bombs,
  with SHA256 + attestation verification before execution); no `shell:true` and
  no composed command strings across 30+ `Bun.spawn` sites; no
  `rejectUnauthorized`/`--insecure`; SQLite `chmod 0600` on every open; all SQL
  built with bound placeholders except closed-branch module constants.
- **Privacy contract is genuinely enforced by tests,** not by substring gates —
  26 behavioural cases including non-TTY-after-opt-in, `CI=0`, `DO_NOT_TRACK`,
  and the on-wire digest. Consent is keystroke-gated at three independent layers.
- **Error classification mappers** (`classifyProviderFailure` and the five
  siblings): read all six. Each documents why its split is where it is, and the
  generic "Video unavailable" rule in `metadata-failure.ts` is deliberately
  ordered last, with a comment saying why.
- **Provider regexes on untrusted markup:** `hianime/parsers.ts` and
  `anidb/browse-parser.ts` precompile attribute patterns, avoid `\b` (which
  matches after `-` and `:`, letting `data-href` shadow `href`), and replace a
  documented-quadratic scan with a linear walk.
- **Timer/resource teardown:** all 15 `setInterval` sites return
  `() => clearInterval`. No `while (true)` without an exit. No
  `if (true)`/`if (false)`/`debugger`/unreachable `return` anywhere.
- **The persistent-shell substrate is real:** exactly **one** `render()` call in
  the app, 9 `mountRootContent` seams. The phase-1.8 objective is substantially
  landed; the plan does not know it.
- **`boundary-imports.test.ts` is a genuinely great test:** per-edge dated
  baselines with written reasons, keyed per file so new files cannot inherit an
  old permission, plus a POSIX self-test that stops the whole rule set silently
  no-op'ing on Windows.
- **CLI paths that behave correctly** (verified, don't re-test): `--help`,
  `--version`, `--dry-run` across 25 combinations, all subcommands through a
  pipe, malformed `--open`/`--handoff-url` (6 forms rejected, exit 1), corrupt
  SQLite (timestamped quarantine, clean start, redacted paths), concurrent
  launches (no lock contention), exit codes 0/1/2/130, no ANSI leaks into pipes,
  no stack traces or absolute home paths in `logs.txt`, `--support-bundle`
  content clean.
- **Dissolved during this audit** (each looked like a finding until the callee
  was opened): `parseIpv6` `octet < 0` (not exploitable); Discord IPC short-frame
  `RangeError` (the caller's catch terminalizes); the `hls-relay`/`atomic-write`/
  `mpv-process-registry` empty catches (all carry rationale); `docs/installer-reference/`
  as a merge artifact (gitignored and actively policed by two gates);
  `kindClause` SQL injection in `watch-stats.ts` (closed 5-branch set, verified
  branch by branch); `RecommendationServiceImpl` N+1 (bounded at 5, and the
  check-and-add has no `await` between iterations); `atomic-write.ts` chmod on
  win32 and the weak `isMuslEnvironmentSync` (both reasoned in the surrounding
  comment — though the _async_ version having zero callers is real, see #474).

---

# L. What this audit did not cover

State the gap rather than implying coverage.

- **macOS and Windows were not executed.** Cross-platform claims rest on CI
  configuration and code reading. The repo's own bar is explicit: a
  cross-platform assertion you have not run on that platform is a guess.
- **No-network cold-start cost** is unquantified —
  `bootstrap-persistence.ts:412` still blocks pre-paint on
  `await Promise.all([anilistAdapter.init(), tmdbAdapter.init()])`, and plan 006
  has not landed.
- **Provider _parse and stream_ correctness** was not exercised (network
  etiquette allowed 1–2 requests per host; that establishes liveness, not
  behaviour). `api.anidb.net`, `allanime.day`, `hianime.at` content paths, and
  the vidrock crypto rotation are unverified.
- **Live resolve-layer behaviour** was read, not executed — no live smoke was
  run, because they fan out across every provider and host.
- `apps/docs` internals beyond the analytics finding and the codegen freshness
  check; `.reference/` design boards; the Termux and Chromecast PRs (#287, #306).
- **Provider search correctness** for hianime and allmanga beyond the relay /
  cache findings; the `imdb:` grammar residue in plan 056.
- One subagent self-corrected mid-run: an apparent 25-second hang on
  `--download` was its own harness (a 0-sized pty), not the product. Discarded.
