# Plan: Release readiness after the October audits

> **Drift check (run first):** every row cites a `path:line` verified on
> `integrate/backlog-20261007` @ `f840fe511` on 2026-10-08. Before starting a
> row, re-open that line on the current tree. If the defect is gone, strike the
> row instead of re-fixing it. Never cherry-pick an old stack head; the
> consolidation plan explains why.

## Status

- **Status:** TODO — verified, not started.
- **Priority:** P1 for Gate 0 and Phase 1; P2 for Phase 2; P3 after release.
- **Effort:** about 3–4 focused weeks for Gate 0 through Phase 2.
- **Owns:** the merge order to a releasable `main`, and the verified residue of
  three external audits (`.docs/research/audit-4-2026-10-07.md`, the canvas
  "Kunai engineering audit", and the antigravity "full repository audit").
- **Does not own:** the stack residue table in
  [2026-10-02-pr-stack-consolidation.md](./2026-10-02-pr-stack-consolidation.md)
  (this plan orders it and adds the rows it missed), architecture splits
  (plans 010–015), or identity migrations (044/045).

## How this was verified

Nine read-only agents checked every claim against the candidate tree, not
`main`, because the candidate already contains 30 merged PRs. Downloads,
storage, sync, and mpv findings were reproduced in sandboxed profiles with
the real repository classes. The mpv replace event order was captured from
mpv 0.41. The UI pass drove the real `main.ts` under `agent:session` at
64×22, 100×30, and 160×45; panes are in `/tmp/kunai-taste/` (local only).
The gates ran uncached on the candidate.

Gate results on `f840fe511`: `typecheck --force`, `lint`, `fmt:check`,
`test --force` (0 failures across 26 tasks), `build`, `verify:doc-paths`,
`verify:doc-frontmatter`, and `verify:dependency-patches` all pass.
`verify:parity-references` fails (ani-cli pin 5.1.4, local checkout 5.1.5).
Skips: 33 Postgres, 14 `KUNAI_BINARY_SMOKE`, 3 Docker, 2 pwsh, 2 live, 1
yt-dlp.

## Already fixed or refuted — do not re-do

| Claim                                                                        | Why it is closed                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cleanupOldBinary` deletes foreign `*.old` (SEC-1/PM-01)                     | `self-replace.ts:28-31` removes only `${binPath}.old` and only from a compiled entrypoint; `self-replace.test.ts:101-123` keeps a foreign `*.old`            |
| `fs.link` on exFAT/SMB deletes the download (antigravity DL-02)              | `publishStagedDownloadArtifact` falls back to `copyFile` on `EXDEV/EPERM/ENOTSUP/EOPNOTSUPP` (`DownloadService.ts:312`, #569); `download-publish.test.ts:58` |
| Watchdog `coreIdle` hides cache stalls (A02)                                 | `playback-watchdog.ts:9-12` dropped `coreIdle`; mpv 0.41 confirms `core-idle=true, pause=false` during a cache stall and the predicate no longer swallows it |
| Prefetch rejection is fatal (CONC-02)                                        | The only caller catches (`PlaybackPhase.ts:2481-2496`)                                                                                                       |
| Per-episode abort listeners leak                                             | `{ once: true }` plus `finally` removal (`PlaybackPhase.ts:1096`, `3908`)                                                                                    |
| Trailer mpv handle dropped                                                   | `SearchPhase.ts:103-121` keeps and kills it (env scrub still missing, see P2-11)                                                                             |
| Due downloads starved by deferred rows (A20/DATA-4)                          | Worker uses `listDueQueued` (`download-jobs.ts:664`); `listQueued` has no production caller                                                                  |
| Offline plays a different file when the provider is retired (A18, main half) | #562/#564: local resolution runs before `providerRegistry.get`                                                                                               |
| Corrupt config overwritten by defaults (DATA-6)                              | `FileStorage.ts:125-164` diverts writes after a fallback load                                                                                                |
| Config lock reclaim erases a live lock (ST4)                                 | Token-matched release inside `withConfigLockTransition` (`FileStorage.ts:199-237`)                                                                           |
| Outbox wedged by one poisoned row (SI-04, outbox half)                       | `parsePayloadJson` fails open; `poisoned-rows.test.ts:170`                                                                                                   |
| Notification tombstones unbounded (SI-09)                                    | Capped in `maintenance.ts:92,315`                                                                                                                            |
| Live `<<<<<<< HEAD` marker (A17)                                             | Zero markers in the tree                                                                                                                                     |
| Shared relay URL baked in                                                    | `providerRelay.baseUrl` is `""` (`packages/config/src/defaults.ts:121`); no media route                                                                      |
| Miruro uses the old HLS expander (plan 050)                                  | `expandHlsMasterInventory` only (`miruro/direct.ts:58,966`)                                                                                                  |
| `MR-05` CORS origins not forwarded                                           | `relay-runtime-policy.ts:64-71` forwards them                                                                                                                |
| "No pending changesets"                                                      | About 100 changesets are pending in `.changeset/`; #327 is stale, not empty                                                                                  |

## Gate 0 — Land the integration as one PR

Nothing else starts until this is merged. Every later row is written against
it.

1. Fold the four PR heads that moved after the integration merged them:
   `#576 e32921f16` (fence expired IPC writes), `#573 ec5f14f3f` (decode
   filesystem causes in `FileStorage`/`config-lock`), `#574 7087d70e2`
   (handoff gating, guide row budget), and only the docs commit of #569
   (`57d5a786f`).
2. Merge #577 (`isJsonString` without conversion hooks). It applies cleanly.
3. Decide `verify:parity-references`: bump the pin to 5.1.5 or confirm it is
   local-checkout-only. CI must be green, not "green except one".
4. Push `integrate/backlog-20261007` and open one PR onto `main`. Do not merge
   the 30 PRs individually. They stack on non-main bases, and merging a base
   retargets its child onto `main` and drops the conflict resolutions.
5. Required checks on that PR: Linux, Windows, and macOS legs, plus one run
   with `KUNAI_BINARY_SMOKE=1`. The default Linux test job does not set it
   (`ci.yml` ~245-299), so 14 binary smokes are skipped there.
6. After merge, close the 30 integrated PRs and the superseded #500, #501,
   #520, #522 with a link to this plan. #306 is not "no diff" (77 files); it
   stays parked.
7. Main-checkout hygiene, owner's call, nothing deleted by an agent:
   untracked `.plans/048-058` and the `2026-10-01-*` packets duplicate files
   already in `.archive/plans/` on the candidate; add `*.sqlite-wal` and
   `*.sqlite-shm` to `.gitignore` (`packages/storage/undefined/` shows as
   untracked because only `*.sqlite` is ignored); decide whether
   `apps/cli/test/vhs/golden/` is committed or ignored; `packages/design/src/tokens.ts`
   is a real local edit.

Acceptance: `main` equals the reviewed candidate plus the four deltas and
#577, and every gate above runs uncached and green.

## Phase 1 — Release blockers

Each row is its own PR from `main`, with a test that fails before the fix.
Rows in one group share a primitive and land together.

### 1A. Downloads must not lose or claim files (P1)

| Row            | Defect (verified)                                                                                                                                                                                                                                                                                                                                                                       | Fix                                                                                                                                                                                                                                                                                     | Test that must fail first                                                                                 | Effort |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| DATA-1         | Crash recovery adopts or deletes any file already at `outputPath`. `DownloadService.ts:1932` stats it; without ffprobe a nonempty foreign file becomes `completed`; with ffprobe failure it is unlinked (`:1986`). `publishedJobIds` (`:353`) is memory only. Reproduced both outcomes.                                                                                                 | Persist a publish marker after `link`/`copy` and before removing the temp. Recovery may touch `outputPath` only when the marker is set, or temp and output share an inode. Otherwise fail the job and leave the file.                                                                   | Stale running job, pre-existing foreign file, ffprobe on and off: bytes unchanged, status not `completed` | S      |
| DATA-2 / A04   | `deleteJob` swallows `rm` errors (`DownloadService.ts:1203`), emits `deleted` (`:1223`), drops the row (`:1224`). Reproduced: `0555` directory, row gone, file stays, next publish hits `EEXIST`.                                                                                                                                                                                       | Return `DownloadDeleteResult` (`deleted` / `missing` / `retained`). On `retained`, keep the row and do not emit. Update every caller: `library-shell.tsx:318` (also unawaited), `download-manager-shell.tsx:326`, `offline-library-action-router.ts:268`, `shell-workflows.ts:470,618`. | Unwritable directory: row kept, UI says it could not remove the file                                      | S      |
| SI-07 + DATA-8 | `removeForJob` runs on `deleted` even when the unlink failed; `relocateTitleId` uses `UPDATE OR REPLACE` (`offline-assets.ts:220`) and drops the destination row's `file_path`. Reproduced.                                                                                                                                                                                             | Remove asset rows only for a `deleted`/`missing` result. Relocate keeps one row per path and never `REPLACE`s.                                                                                                                                                                          | Two ids for one episode, relocate, both files still referenced or one reported as orphaned                | S      |
| Fence          | #573 fenced the status transitions. Still unfenced: `markHeartbeat` (`download-jobs.ts:367`), `updateProgress` (`:373`), file size, metadata, resolved stream, `markArtifactValidated`, `delete`. Cancel is not re-checked after `validateCompletedArtifact` (`DownloadService.ts:1400-1409`), and in-process `abort` then treats this process as a foreign owner and leaves `running`. | One owner-and-status predicate for every mutation. A `publishing` set so local abort is not "foreign". Re-check cancel after validation and before `link`/`copy`. Clear `cancellationRequests` on persisted abort and on `retry` (DL-03, reproduced: retry instantly re-aborts).        | Two `DownloadService` instances on one DB file; cancel during the copy window                             | M      |

Order: DATA-1, then DATA-2 with SI-07/DATA-8, then the fence. The #504
cleanup-review port (Phase 2) must wait for `DownloadDeleteResult`; on today's
`Promise<void>` it would report failed deletes as freed space.

### 1B. Playback must not end an episode on its own reconnect (P1)

| Row              | Defect (verified)                                                                                                                                                                                                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                  | Test that must fail first                                                         | Effort |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------ |
| ASYNC-3 + A03    | mpv 0.41 emits `end-file reason=stop` for the replaced file after the `loadfile … replace` ACK and before `file-loaded`. `mapMpvEndReason` maps `stop` to `quit` (`mpv-stats.ts:279-281`); `handlePlaybackEnded` clears the pending reconnect (`PersistentMpvSession.ts:1565-1576`) and resolves the cycle as a quit (`:1596-1613`). Seek and subtitle reattach never run; autoplay pauses. Reachable from every `network-read-dead` stall. | Re-implement `c48f6465f` (#528): while a reconnect load is pending, ignore `stop` only; still honour the `error` that a failed replace emits next. Add the `activeCycle === active` re-check after the await, and guard the caller's null and the catch (`:1746-1760`) the same way. | Harness injects ACK → `end-file stop` → `file-loaded`, and ACK → `stop` → `error` | S      |
| Socket sweep     | `writeMpvSensitiveConf` writes `${socket}.conf` with stream credentials (`mpv.ts:615`); a crash leaves it on disk.                                                                                                                                                                                                                                                                                                                          | Port the startup sweep from #544 (`1d6e88220`).                                                                                                                                                                                                                                      | Planted stale socket + conf removed on boot; live socket kept                     | S      |
| Wedged downloads | yt-dlp gets only `--socket-timeout` (`DownloadService.ts:1300`); a hung transfer never ends.                                                                                                                                                                                                                                                                                                                                                | Port the output-liveness kill from #544 (`205ecd819`) and, in the same change, unlink `tempPath.part` and `tempPath.part-Frag*` on fail/abort/recovery (A22, reproduced).                                                                                                            | Silent child killed after the idle budget; no `.part` left                        | S      |

The rest of the #528 watchdog stack (no-progress reconnect `3e1006584`,
slow-open narration `04bc4ecd4`, stall stats `05016b78b`) lands right after
ASYNC-3 as one change, because no-progress reconnects without the `stop`
guard repeat ASYNC-3. Hardware ceilings (`4d36ee292`) are not a blocker.

### 1C. Consent and credentials (P1 — hard rules)

| Row   | Defect (verified)                                                                                                                                                                                                                                                                                | Fix                                                                                                                                               | Test that must fail first                                                              | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------ |
| ST1   | A completed analytics ping re-reads memory, not disk (`usage-analytics-service.ts:263-273`). Reproduced with two `ConfigServiceImpl` on one sandbox config: window B disables and clears `installId`; A's 204 writes the id and `lastAnalyticsPingAt` back. This breaks hazard 3 in `AGENTS.md`. | Under the existing config lock, reload; write bookkeeping only if disk consent is still enabled and the id is unchanged. Otherwise write nothing. | Two instances; disable during a held 204, 400, 503, and transport failure              | S      |
| A05   | `persistToken` sets the token before Viewer validation (`AniListAdapter.ts:339-342`); a stale `userId` skips the `!userId` guard (`:344`). Reproduced: Viewer 500 returns `{ok:true}` and stores the new token under the old user, then `resumeAfterReauth` unparks rows.                        | Validate into locals; persist only after a Viewer id; unpark only after that persist.                                                             | Old `userId` loaded, Viewer 500/401/network error: nothing persisted, rows stay parked | S      |
| SI-05 | Token file lane turns any read error into `{}` (`SyncTokenStore.ts:51-54`); the next patch wipes the other tracker's token. A vault `get` stall after a good probe rejects `anilistAdapter.init()` with no catch (`bootstrap-persistence.ts:447`), so boot fails.                                | Treat only `ENOENT` as empty. On vault failure during init, continue disconnected with a visible notice.                                          | `EIO`/`EACCES` read keeps both tokens; stalled vault still reaches the shell           | S      |

The analytics privacy contract (`.docs/analytics-privacy-contract.md`) must be
re-read before touching ST1, and the three architecture gates must still pass.

### 1D. Untrusted text and targets (P1 for the share link, P2 otherwise)

| Row              | Defect (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                                                                                       | Effort |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Sanitizer sinks  | Row builders are sanitized now. Still raw: `ink-shell.tsx:1602-1603` list-shell title/subtitle, which renders the `kunai://` handoff query from `share-ref-from-context.ts:61` **before** the user confirms; `loading-shell.tsx:732,752` provider line and trace; `library-title-detail.tsx:256` title. `sanitizeTerminalText` drops the C1 `0x9d` introducer but leaves its payload (`52;c;SGVsbG8=`). `stripHtml` passes escapes through. `render-capture` strips CSI only, so snapshots cannot see OSC. | One structural fix, not per-site patches: a branded `SanitizedText` type produced only by `text-display.ts`; type the Ink props that carry remote text with it; strip the C1 string body; make `render-capture` fail on any `\x1b]` or `\x9d` in a frame. Add a hostile-string component test over the handoff dialog, loading shell, and library detail. | S–M    |
| mpv targets      | `isAllowedMpvUrl` admits any `http(s)` host including `127.0.0.1` and RFC1918 (`mpv-playback-url.ts:4-10`). Manifest-embedded targets are not vetted. yt-dlp has `--` only on the metadata path.                                                                                                                                                                                                                                                                                                           | Port #543 (`35a661186`, `9f03f01c7`): refuse private literal hosts, vet manifest and deferred targets, `--` before the watch URL. **Decision needed:** the real-mpv tier serves from `127.0.0.1`; use an injected allowlist in the test harness, never an env bypass.                                                                                     | M      |
| Miruro redirects | Redirects are followed by curl, unvetted per hop.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Walk redirects in-process (#543 `b88bc3655`) with the existing guarded fetch.                                                                                                                                                                                                                                                                             | M      |
| Poster fetch     | `poster-source-cache.ts:116-117` uses plain `fetch` (https-only check, no DNS revalidation); subtitles and offline artwork use `fetchGuardedStreamTarget`.                                                                                                                                                                                                                                                                                                                                                 | Route it through the guard.                                                                                                                                                                                                                                                                                                                               | S      |
| Child env        | HLS relay curl (`hls-relay.ts:226-229`) and trailer mpv spawn without `scrubbedChildEnv()`.                                                                                                                                                                                                                                                                                                                                                                                                                | Pass it.                                                                                                                                                                                                                                                                                                                                                  | XS     |

### 1E. The shell must act on what the user chose (P1)

| Row              | Defect (verified)                                                                                                                                                                                                                                                                                                                                                                                                              | Fix                                                                                                                                                                                                                   | Effort |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ASYNC-1          | Superseded searches still dispatch `SET_SEARCH_RESULTS` after `await` with no generation check (`SearchPhase.ts:814-874`); only the Ink copy is gated. Browse `d` passes the highlighted row, but palette `/download` reads `searchResults[selectedResultIndex]` (`shell-workflows.ts:1787-1790`).                                                                                                                             | One search generation token; commit session state only for the current request, like `onCalendarAccepted` (`SearchPhase.ts:654-659`); every download entry point passes the selected result.                          | S      |
| Destructive keys | Running-download `x` aborts immediately (`download-manager-shell.tsx:316`); queue `c`/`x` (`root-overlay-shell.tsx:1730-1744`) and notifications `d`/`C` are immediate with no undo.                                                                                                                                                                                                                                           | Re-implement #505's press-again confirm as one `useArmedAction` hook, and the Esc ladder filter → disarm → close (library and downloads skip steps today).                                                            | M      |
| `/` capture      | On History, `/` types into the overlay filter while the palette opens: frame shows `Filter: //schedule` and the list empties.                                                                                                                                                                                                                                                                                                  | `/` opens the palette only; an armed filter shows `[esc] clear filter` in the footer.                                                                                                                                 | S      |
| Fatal rejections | `unhandledRejection` is fatal (`main.ts:1356`). No `.catch` on: settings persist (`SettingsShell.tsx:139,155,187`), stats genres (`ink-shell.tsx:1788`), workflow download (`shell-workflows.ts:847`), history launch (`root-overlay-shell.tsx:1657`), download abort/delete (`download-manager-shell.tsx:316,326`), library protect (`library-shell.tsx:333-340`). Each is one keystroke on a read-only profile from a crash. | One `voidSafe(label, promise)` helper that routes to playback feedback or overlay status; plan 062 owns the convention. Also fix UX-02: "Marked watched" before the write lands (`root-overlay-shell.tsx:1964-1968`). | S      |

### 1F. Relay and providers (P1 for relay users)

| Row              | Defect (verified)                                                                                                                                                                                                                                                                        | Fix                                                                                                                        | Effort |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| Relay roster     | Relay server registers 6 providers (`apps/relay-server/src/provider-registry.ts:11-18`); the CLI offers 11 as relay-capable. The drift check probes the server's own list, so it cannot see omissions. A configured relay returns 404 for hianime, animegg, kickassanime, movy, vidrock. | Re-implement #502's single production roster and typed relay refusal, plus a parity test that fails when the lists differ. | M      |
| Relay finality   | Miruro's curl fallback ignores `isRelayedResponse` (`miruro/direct.ts:1664-1751`), so relay errors fall back to a direct fetch.                                                                                                                                                          | Same finality check as HiAnime (`hianime/client.ts:280-298`).                                                              | S      |
| Not-found health | `isProviderHealthNeutral` omits `not-found` (`resolve-helpers.ts:79-94`). Reproduced: five misses mark a provider `down`, healing to degraded at 4h and healthy at 8h, and auto-fallback skips it.                                                                                       | Make `not-found` neutral.                                                                                                  | XS     |
| Movy 403         | Non-404 HTTP errors become `candidate-network` (`movy/direct.ts:631-641`); two 403s halt the cycle as `network-offline`.                                                                                                                                                                 | Map 401/403 to a blocked class.                                                                                            | XS     |

### 1G. Release mechanics (P1)

- Fix the packaging docs: `PACKAGING.md:35` and `RELEASING.md:211` say
  `cd apps/cli && bun pm pack`; the real pack root is `apps/cli/dist/npm`.
- Pin the tag-pinned actions in `ci.yml` and the other workflows to SHAs
  (`release.yml` is already pinned), and add dependency monitoring (#523).
- Installer bootstrap: `install.sh` / `install.ps1` run from moving `main`.
  Document a tag-pinned install command. Ed25519-signed checksums (#507
  `30f173179`) are a separate decision; if adopted, `install.ps1` must enforce
  them too (review ST2).
- After 1A–1F merge, let Changesets regenerate #327 and qualify the actual
  candidate: deterministic gates, provider signoff, real mpv, poster
  protocols. This repeats the existing "Release-focused train" in the roadmap.

## Phase 2 — Release quality: UI, UX, and taste

Evidence for every row is a captured pane in `/tmp/kunai-taste/` from
`agent:session` on the candidate. Rows marked **blocking** look broken or
mislead the user. Fix those before release; the rest can follow in the first
patch.

| #   | Surface                | What is wrong (captured)                                                                                                                                         | Fix                                                                                                                                | Effort | Blocking |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| 1   | Search results, 100×30 | The preview box overlaps itself: `─── Synopsisvourit…`, `└───────────UR…──────────┘`; footer reads `[↑↓] navigate · ↑↓ end…`. "2 results" with one visible row.  | Measure the rail as a real column; drop the rail below that width; one `[↑↓]` hint                                                 | M      | yes      |
| 2   | Setup, 64×22           | Choice titles disappear (`▌   TMDB catalog, series and films`); language labels collide (`Englishes`); footer wraps into labels                                  | Single column under ~80; footer collapses to `[enter] [b] [s]`                                                                     | M      | yes      |
| 3   | Playback failure       | Chip says `Tracks`, status `● ready`, body is a wall of provider names (`✕ Killjoy no-streams · failed …`)                                                       | Playback-issue hero from sakura canonical §6: what failed, progress not marked, one recover action; sources behind diagnostics     | M      | yes      |
| 4   | Post-play              | Two names (`Up Next` chip, `Post-play` label), two footers at 64/160, advertised `x` cancel does nothing, Kanna rail overlaps the hero border at 160             | One chip, one footer, rail gets its own columns or does not mount                                                                  | M      | yes      |
| 5   | Details sheet          | `Smoke Seriesr`, a stray `S`, says "queue", advertises `e episodes` which does nothing, search footer still visible                                              | Full-screen sheet, shell footer replaced, Up Next vocabulary, only working keys                                                    | S      | yes      |
| 6   | Help, 100 and 64       | Command names split across columns (`/export-diagno` / `tics`)                                                                                                   | One column under 120; never split a token                                                                                          | M      | yes      |
| 7   | Series open            | Enter on a series flashes `Resolving sources` with no footer, then returns to search with no message (confirm with `agent:drive` first; may be fixture-specific) | If episodes cannot load, say so and stay on the title; also UX-08 (`session-flow.ts:321-323` turns an outage into an empty picker) | S      | yes      |
| 8   | Setup header           | Stays `Picker · series · vidlink · ● ready` from step 1 to the end; welcome copy overlaps at 64                                                                  | Chip `Setup`, step `1/7`, no provider                                                                                              | S      | yes      |
| 9   | Setup summary          | Teaches `/discover` and `/calendar`; neither is a command                                                                                                        | Advertise real commands only                                                                                                       | XS     | yes      |
| 10  | Library empty          | Repair line ("press x to remove…") on an empty list; "runway" in user copy                                                                                       | Empty template only; repair line only for repairable rows                                                                          | XS     | yes      |
| 11  | Footer system          | Three footer dialects; secondary keys in info-blue; settings footer mid-screen                                                                                   | One pinned footer renderer; rose for the primary key only                                                                          | M      | no       |
| 12  | Analytics step         | Cursor starts on "Turn it on ← recommended"; shows a JSON payload                                                                                                | Cursor on Keep off, plain sentence, no JSON; no skip-the-rest on this step. Keep the explicit-keystroke rule intact                | S      | no       |
| 13  | Kanna on empty screens | The empty line changes with terminal width and restates the empty message                                                                                        | One line per state, width-independent, only under a one-sentence empty                                                             | S      | no       |
| 14  | Search query line      | After submit the query disappears between two empty rules; zero results says "no results" twice                                                                  | Keep `› query`; one empty sentence with a next step                                                                                | S      | no       |
| 15  | History chrome         | `1 titles`; two `All` tabs; a filter-empty shows the global empty; `[enter] resume` with nothing to resume                                                       | Grammar, named filter empty, hide resume                                                                                           | S      | no       |
| 16  | Settings header        | Provider codenames (`series vidlink · anime hianime`); tabs run into hints                                                                                       | Human labels; pinned footer                                                                                                        | S      | no       |
| 17  | Up Next empty          | Body says "Queue is empty"                                                                                                                                       | Up Next vocabulary (ADR 0001)                                                                                                      | XS     | no       |
| 18  | `NO_COLOR`             | Still emits 16-color and inverse chips                                                                                                                           | Monochrome plus glyphs                                                                                                             | S      | no       |
| 19  | CLI grammar            | `--search=Dune`, `-SDune`, and `--` exit 2 (`cli-args.ts`)                                                                                                       | Split `=`, accept packed short values and `--`                                                                                     | S      | no       |
| 20  | Episode picker         | `s`/`m` are stolen from the always-focused filter (`root-overlay-shell.tsx:1928-1978`)                                                                           | Focus zones: filter owns printable keys                                                                                            | M      | no       |

Keep, the pass found these good: the History selected row, the Ember Dusk
palette, 160-column help, the four global keys, palette resolving "queue" to
`/up-next`, the analytics choice staying off on Down+Enter and `s`, and the
64-column search hiding its rail.

Structural UI work. Each item goes to an existing owner; do not create a
second board.

1. **One keymap, four readers.** Handlers, footer, `?` help, and
   `.docs/keybindings.md` are generated from `keybindings.ts` with a width
   budget that drops whole actions. Owner: plan 022, footer row in
   persistent-shell. This removes the class behind rows 4, 5, 6, 11, and the
   History `/` capture.
2. **One state template** for loading, empty, error, and "nothing in this
   filter". Owner: sakura rollout (the StateBlock in
   `missing-surfaces-implementation-map.md`).
3. **Playback issue is its own surface, not Tracks.** Owner: beta UI/provider
   hardening (display honesty).
4. **Rail, poster, and Kanna share one column budget.** Hide preview before
   titles. Owner: fullscreen root shell and image protocol plans.
5. **Width matrix in CI.** Add 64×22 and 160×45 `agent:drive` captures for
   setup, search, post-play, and help to the golden suite, and fail on two
   strings sharing a cell. Owner: the agent verification harness.

## Phase 2 — Correctness that can follow the blockers (P2)

| Row                                   | Defect (verified)                                                                                                                                                                                                                                                                                                                                                                                                                    | Fix                                                                                                             | Effort |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------ |
| DATA-02                               | No repository uses `transaction.immediate`; a read-then-write returns `SQLITE_BUSY_SNAPSHOT` in 0 ms under a second instance. Reproduced on `HistoryRepository.upsertProgress` (`history.ts:109-120`), which drops a progress checkpoint. Same shape in `lists.ts:202,255`, `sync-outbox.ts:267`.                                                                                                                                    | One immediate-transaction helper for every read-then-write; move `deleteByDedupKey` (SI-03, reproduced) onto it | M      |
| A06                                   | `deliver` (`SyncService.ts:647`) calls `adapter.apply` without re-checking generation; a superseded write can land last with two instances.                                                                                                                                                                                                                                                                                          | Re-check generation before `apply`; keep the claim until delivery ends                                          | M      |
| A11                                   | Config scalars pass through unnormalized; reproduced `downloadPath.trim is not a function`, and the same for Wyzie key, presence client id, mpv bridge path/opts. #577 does not cover this.                                                                                                                                                                                                                                          | Coerce known scalars to defaults on load, mark dirty                                                            | S      |
| SI-01 / SI-10                         | `playback_events` is insert-only (~240 rows/hour of playback); closed `playback_queue_sessions` are never deleted.                                                                                                                                                                                                                                                                                                                   | Age plus row-cap sweep in data-DB maintenance                                                                   | S      |
| SI-04 rest                            | Bare `JSON.parse` in `title-provider-health.ts:37` and `sync-reconciliation.ts:206`.                                                                                                                                                                                                                                                                                                                                                 | Shared fail-open reader; delete the bad row                                                                     | S      |
| SI-06                                 | Quarantine renames by path with no inode check (`sqlite.ts:162`).                                                                                                                                                                                                                                                                                                                                                                    | Refuse rename if device/inode changed since the failed probe                                                    | M      |
| A19                                   | `listTitleAssets` `LIMIT 100` (`offline-assets.ts:174`); reproduced: episode 101 reported unavailable offline.                                                                                                                                                                                                                                                                                                                       | Page or uncap the playback lookup; pass the clicked job id (also fixes sub/dub picking the newer file)          | S      |
| PROV-2                                | AllManga skips `verifyCandidateStream` on the `deferredLocator` branch (`allmanga/direct.ts:677-682`) while the coverage test only greps for the call.                                                                                                                                                                                                                                                                               | Probe after materialization or record a runtime exemption; make the coverage test behavioural                   | M      |
| Caches                                | Uncapped `TTLCache`s: `anime-metadata.ts:26,29` (30-day), `allmanga/resolve-show-id.ts:17`, `allmanga/api-client.ts:548,553`.                                                                                                                                                                                                                                                                                                        | Pass `maxEntries`                                                                                               | XS     |
| SEC-3                                 | curl-impersonate discovery picks the highest version across all of `PATH` (`curl-impersonate.ts:114-136,271-281`).                                                                                                                                                                                                                                                                                                                   | Prefer the managed directory, then first-on-PATH                                                                | M      |
| Doctor                                | mpv/yt-dlp/ffprobe are PATH-checked only; `probeMpvVersion` exists unused; `--strict` missing from help; `diagnostics recent` ignores bad `--format`/`--limit`.                                                                                                                                                                                                                                                                      | Exec-probe, help line, exit 2 on bad args                                                                       | S      |
| Docs truth                            | `ACCESSIBILITY.md:38` says there is no reduced-motion switch (`KUNAI_REDUCED_MOTION` ships); `/privacy` says "no sync" while trackers sync.                                                                                                                                                                                                                                                                                          | Correct both in the same change as any behaviour they describe                                                  | XS     |
| Test truth                            | Zero-assert tests (`tmdb.test.ts:126-141`, `BinaryAutoUpdater.test.ts:21-28`); fetch stub falls through to the real network (`anime-discovery-resolve-handoff.test.ts:51-55`); `pty-transcript` skips without `expect`; provider package tests have no `--timeout`.                                                                                                                                                                  | Fix each; add a multi-process harness used by the download fence, DATA-02, ST1, and SI-06 tests                 | M      |
| Residue the consolidation plan missed | #525 artwork sanitizer (`aa2af5676`), #526 IPC parse cap (`e0dedab85`), #527 post-play key honesty (`49789f646`, `8089f13bc`), #539 DNS budget, body caps, rivestream fan-out, #540 updater foreign files (`4093fcfee`), #506 AniSkip/MAL cache caps (`13be48e2c`), #545 legacy mouse strip, orphan-flag warning, display columns, Miruro `/api/v1`, #507 offline job pin and lease fence. Add these rows to the consolidation plan. | Re-implement from `main`                                                                                        | M      |

## Phase 3 — After release

- Delete dead surfaces: `ShellService` and `container.shell`,
  `picker-controller.ts`, `tmdb.ts formatEpisode`, `listQueued`,
  `OfflineMaintenanceService` (or wire it), `savePlaybackHistory`, the
  `post-playback` scope typo in `input-router.ts`, dead `RELAY_HOP_HEADER`.
- Plans 044 then 045. A startup consolidation merge today orphans lists,
  follows, downloads, and offline rows keyed by a bare MAL/AniList id.
- Transport stack #508–#511 and browse hook extractions #513–#519: redo
  against current files only if still justified. Mouse input #521 is a
  feature.
- Measure before optimizing (plan 060). No cache or lazy import from a line
  count.
- Splits of `PlaybackPhase`, `ink-shell`, `root-overlay-shell` stay blocked on
  render-level characterization tests (plan 010), not on the old ordering.

## Seams to walk on every row

- **Declaration → reader:** a new result type (`DownloadDeleteResult`) is a
  no-op until every caller listed in the row reads it.
- **Entry points:** destructive confirms and the search generation token
  cover browse, palette, hotkeys, and post-play.
- **Both lanes:** offline lookup and history rows need an anime and a TMDB
  decision.
- **Every provider:** relay finality and health neutrality need a per-adapter
  decision.
- **Every platform:** pwsh tests count as skips locally; the Windows leg must
  run them.
- **Docs:** update the owning doc in the same PR.

## Acceptance

- Gate 0 merged; Phase 1 rows merged with their failing-first tests.
- Blocking UI rows fixed and re-captured at 64×22, 100×30, and 160×45.
- #327 regenerated and qualified on the actual candidate.
- Move this plan to `.archive/plans/` when the Phase 1 and blocking Phase 2
  rows are done, and leave one roadmap row for what remains.
