# Kunai codebase audit and remediation priorities — 2026-09-30

**Status: AUDITED; remediation unfinished.** Advisory report, not an implementation or release signoff. Initial baseline: `main@b0660265e6920d98fcc8f3e342e36b9db1852c08`, with existing uncommitted provider-test work. Other work landed `9c49453f0` and `a1849a389` during the audit; provider/security review and the provider suite used `main@a1849a389e5c746d9180e21ddc02c6d84d6b4eb7`. The supplemental offline review used `1ba51d629`, whose additional changes were provider tests. A01 and A09 distinguish repaired defects from remaining work. No source code, live profile, production service, release, GitHub issue, or memory was changed by this audit. Its repository writes are this report and its roadmap link.

## Planning reconciliation — 2026-10-01

The historical observations below remain tied to their original snapshots.
Current handoff baseline is `fix/resolve-gate-coverage@e5fd018af`.
`e5999a22a` repaired A01's 1 ms DNS budget; its AniDB wrapper/policy gap remains
in [R01](./2026-10-01-r01-provider-transport.md). `e5fd018af` strengthened A09's
roster gate to reject an empty parse; behavioral coverage remains planned.
Do not reimplement either landed fix.

The user supplied `{}` as the September 30 `bun audit --json` result, without
exit status or lockfile fingerprint. This adds user-reported advisory evidence;
the earlier agent lookup was still blocked and no fresh agent-run dependency
audit is claimed. Revalidate current dependencies under
[R07](./2026-10-01-r07-build-and-analytics.md) before upgrades.

[Execution runbook](./2026-10-01-execution-runbook.md) and its ten packets map
every A01–A22 finding to implementation, regressions and qualification gates.
Planning does not close findings or qualify a release.

## Assessment

Kunai already has a useful architecture: pure domain policy, app-scoped entrypoints, explicit provider modules, platform-resolved persistence, a durable outbox, controlled analytics consent, and tested release provenance. The highest-value work is to make those contracts hold through every caller and failure state. Several serious defects survive passing tests because the tests cover the happy sequence, a single worker, or a hand-maintained roster.

Prioritize reliable playback, truthful persistence and recovery, and coherent keyboard interactions before more surfaces or infrastructure. A new framework, plugin architecture, universal provider superclass, cloud account system, or wholesale UI redesign would increase the maintenance burden without repairing these defects.

### Scope and evidence limits

All five apps and all eight shared packages were mapped. Deep reads concentrated on production provider/fallback paths, transport trust boundaries, player lifecycle, persistence/config/outbox/deletion, mobile state/runtime ports, shell interactions, analytics, docs generation, installers, and CI/release gates. All twelve production provider modules were traced. This is a subsystem-wide, risk-weighted audit, not a claim that every source line was reviewed or that no other bugs exist.

The audit used the feature map, owning subsystem docs, current roadmap, callers, existing tests, and controlled reproductions. Historical plans and archived modules were not treated as current behavior. Source content was never used to reproduce secret values. Runtime checks isolated HOME, XDG roots, APPDATA, and LOCALAPPDATA; SQLite was temporary or in-memory. No real-profile database was opened.

No physical mobile playback, live OAuth mutation, live provider reliability matrix, interactive terminal walkthrough, native Windows/macOS execution, release build/publication, hosted branch protection/environment configuration, or deployed firewall/retention configuration was qualified. Docs UI received code-level review, not a browser visual/accessibility audit. Dependency advisory lookup remains incomplete because automatic approval review rejected exporting package metadata to npm.

## Priorities

P1 means fix before qualifying the affected path for release. P2 means meaningful reliability/security/product improvement. P3 means maintenance or verification hygiene. S/M/L estimate fix effort including regression tests, not a promised schedule. Risk describes the change, not the severity of the defect.

| ID  | Priority | Finding                                                                      | State                                        | Effort / fix risk     |
| --- | -------- | ---------------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
| A01 | P1       | HLS wrapper and DNS deadline gaps remain in the new transport guard          | Residue verified after concurrent repair     | M / MED               |
| A02 | P1       | Cache buffering disables the playback watchdog                               | New; reproduced                              | S–M / MED             |
| A03 | P1       | Late reconnect failure erases a newer playback cycle                         | New; reproduced                              | M / MED               |
| A04 | P1       | Failed file deletion still deletes managed records and reports success       | New; reproduced on Linux                     | M / MED               |
| A05 | P1       | AniList reauthorization can report connected with a rejected token           | New; reproduced                              | M / MED               |
| A06 | P1       | Two sync workers can regress remote progress with an empty outbox            | New; reproduced; sync experimental           | M–L / HIGH            |
| A07 | P2       | Relay server omits five relay-safe production providers                      | New; reproduced                              | S–M / LOW             |
| A08 | P2       | One refused URL suppresses valid siblings on the same CDN                    | New; reproduced                              | S / LOW–MED           |
| A09 | P2       | Provider gate roster repaired; behavioral coverage still needs strengthening | Addressed concurrently; test residue         | M / MED               |
| A10 | P2       | Repeated Android state-write failures delete the last backup                 | New; reproduced                              | S / LOW               |
| A11 | P2       | Malformed known config fields crash startup                                  | New; reproduced                              | M / MED               |
| A12 | P2       | Cycle failure translation loses rate-limit/server-error causes               | New; reproduced                              | S / LOW               |
| A13 | P2       | Bun relay reads an oversized envelope before enforcing its limit             | New; reproduced                              | S / LOW               |
| A14 | P2       | Docs Turbo tasks omit external inputs and environment variables              | New; dry-run verified                        | M / LOW–MED           |
| A15 | P2       | Retired installations can be counted twice on return                         | New; memory-store reproduction + SQL review  | S–M / MED             |
| A16 | P2       | Destructive actions, filter focus and save feedback remain inconsistent      | Existing plan 022; current residue verified  | M per slice / LOW–MED |
| A17 | P3       | Local verification and infrastructure documentation disagree                 | New maintenance residue                      | S / LOW               |
| A18 | P1       | An explicit offline job launch can play a different local artifact           | New; reproduced with real repositories/files | M / MED               |
| A19 | P2       | Offline lookup and library discovery truncate durable local content          | New; episode 101 reproduced                  | M / LOW–MED           |
| A20 | P2       | Deferred queue rows hide runnable downloads behind the first page            | New; reproduced                              | S / LOW               |
| A21 | P1       | Losing download preflight can overwrite another worker's running claim       | New; two-worker reproduction                 | M / MED–HIGH          |
| A22 | P2       | Permanent abort/delete leaves yt-dlp partials without a managed owner        | New; actual filename conventions + fixture   | M / MED               |

### A01 — Complete the guarded transport contract, then qualify it

**Evidence and reachability:** `packages/providers/src/shared/hls-ladder.ts` calls `fetchGuardedStreamTarget` before candidate verification. Production wrappers come from `packages/providers/src/hianime/client.ts` and `packages/providers/src/anidb/client.ts:826`. The AniDB text wrapper forwards cancellation but discards the guarded fetch's redirect and header policy. Its lower transports use redirect-following fetch/curl. A wrapper that follows redirects itself hides subsequent targets from the outer guard.

The original resolve gate always received a bound provider fetch, while DNS validation was inferred using fetch-function identity. Concurrent commit `a1849a389` added DNS pinning and the `resolvesLocally` port field and threaded lookup into the gate and some HLS callers. **The earlier resolve-gate bypass was repaired; it is not an unchanged finding.** Final reread of that commit confirms AniDB's expansion wrapper still lacks the lookup contract and discards request policy. Also, the guarded fetch's `remaining: () => 1` sentinel now reaches DNS deadline code and imposes a 1 ms lookup budget despite a 12–15 second caller signal. A controlled timer reproduction confirmed a 1 ms scheduled lookup timeout and no fetch when that timer fires.

**Impact:** Provider-controlled target names or hidden redirects can escape local private-address checks; incomplete hardening can also reject legitimate targets or degrade the quality inventory. Before the concurrent repair, a mocked real relay-port/handler chain forwarded an AniDB playlist and video segment through metadata RPC. Treat that as a historical observation requiring regression coverage, not proof that the latest gate still follows that route.

**Disproof and confidence:** Traced wrappers, raw/direct relay branches, marker readers, and redirect callees. The final provider fixture suite passes 920 tests, but does not eliminate these wrapper/deadline gaps. HIGH confidence in the code-level gaps; external exploitability and real HTTPS behavior were not qualified. No live private-network access was attempted.

**Fix and acceptance:** Use a guarded transport whose adapters preserve DNS ownership, checked address pinning, TLS/Host authority, manual redirects, cancellation and byte limits. Do not assume every bound function resolves remotely. Do not pin metadata requests to local IPs and accidentally bypass a user-selected relay. Test each production adapter with mocked private DNS answers, cross-origin redirects, valid public targets, realistic lookup delay and cancellation. Assert that media requests never use metadata RPC and that intentional metadata relay traffic still does. Re-run provider fixtures and real HTTPS/provider signoff after the concurrent patch settles.

### A02 — Distinguish buffering from user pause

**Evidence:** `apps/cli/src/infra/player/playback-watchdog.ts:55` and `:201` include `coreIdle` in `userPausedOrIdle`. Its timer resets incident clocks and returns at `:66`. `PersistentMpvSession.ts:667` only starts dead-network recovery when the watchdog emits the corresponding stall.

**Trigger and result:** Playback has started; mpv reports user pause false, core idle true, cache pause true, network underrun and zero input rate. No stall/reconnect trigger occurs. The [mpv manual](https://mpv.io/manual/stable/#property-list) confirms that core idle can mean low network cache rather than user pause. A controlled clock reproduces zero stall events after 60 seconds; changing only core idle to false produces the expected event.

**Disproof:** Read the property mapping, both watchdog paths, and existing tests. Current starvation tests omit core idle; they pass. No specific roadmap owner for this predicate defect. Confidence HIGH.

**Fix and acceptance:** Classify actual user pause, unloaded idle, buffering and seeking separately, with one policy consumed by observation and timer evaluation. Cache starvation with core idle true must trigger once per incident; actual user pause must not. Include seeking/restart combinations and rearming after fresh progress. Keep the event and recovery budgets bounded.

### A03 — Make reconnect completion conditional on cycle ownership

**Evidence:** `apps/cli/src/infra/player/PersistentMpvSession.ts:1569` awaits reconnect and `:1575` unconditionally clears `activeCycle`. The catch at `:1703` changes shared reconnect state without verifying generation. `PlayerServiceImpl.ts:822` waits on the next persistent playback; the active playback dispatcher exposes next/stop.

**Trigger and result:** Hold an old reconnect loadfile acknowledgement, stop the old cycle, start episode two, then fail the old acknowledgement. The replacement cycle is cleared and its playback promise is orphaned. The deterministic reproduction confirms the new cycle exists before the old completion and is null afterward.

**Disproof:** Checked admission guards, public control retirement, generation helpers and existing replacement tests. Those guards do not cover the internal post-await assignment. Existing tests cover other replacement boundaries, not this one. Confidence HIGH; related decomposition plans do not own this specific defect.

**Fix and acceptance:** Capture generation and cycle identity, then recheck both after every reconnect await before clearing state, emitting failure or resolving a result. Stale success, failure and timeout must leave successor state and events intact. The successor's later EOF must resolve exactly once. Add this regression before broader playback extraction.

### A04 — Keep managed records until deletion has actually succeeded

**Evidence:** `apps/cli/src/services/download/DownloadService.ts:1069` suppresses every artifact-removal error, then `:1087` emits deleted and removes the job. `container/bootstrap-services.ts:265` removes the offline asset. `services/offline/offline-library-action-router.ts:268` subsequently announces deletion.

**Trigger and result:** A completed artifact cannot be removed. A permission-restricted Linux temporary fixture produced a missing job row, a deleted event, and an artifact still on disk. On other platforms, equivalent removal errors are plausible but were not natively reproduced. This can strand disk usage and remove Kunai's ability to manage the file.

**Disproof:** Existing conflicting-owner safeguards are real and must remain. Deletion tests cover competing ownership but not removal errors; no rationale defends the blanket catches. No existing owner for this failure. Confidence HIGH.

**Fix and acceptance:** Missing files can count as removed; classify other failures. Retain primary artifact ownership until removal succeeds and represent partial sidecar cleanup explicitly. Cover every deletion caller, including the library's unawaited calls at `app-shell/library-shell.tsx:313`. Failed deletion must remain visible/retryable; a later successful retry must clean records and files without touching another job's artifact. Inject permission and busy-file errors rather than baking Linux chmod assumptions into cross-platform tests.

### A05 — Validate a candidate OAuth identity before publishing connection success

**Evidence:** `apps/cli/src/services/sync/AniListAdapter.ts:338` replaces the token before validation. `refreshUsername` tolerates rejection/network failure while retaining the old user ID at `:247`. `persistToken` then accepts that ID, clears reauth, persists, and returns success at `:360`. `app-shell/workflows/tracker-connect.ts:99` resumes parked work and announces connected.

**Trigger and result:** Reauthorize an adapter with an existing identity; the new Viewer request returns 401 or cannot complete. The reproduction returned success, persisted the candidate token with the previous identity, and changed needs-reauth to connected.

**Disproof:** Retaining an established credential through temporary startup network failure is intentional and correct. Reusing that tolerant refresh operation as admission for a replacement token is the defect. Existing tests do not cover rejected replacement with retained identity. Confidence HIGH.

**Fix and acceptance:** Validate candidate token and Viewer into temporary values with the connect AbortSignal. Commit storage and publish new adapter state only after successful validation. Failed replacement must not announce connection or unpark mutations. Test 401/403, timeout, cancellation, malformed Viewer and storage rejection with an existing account, plus successful replacement with a different account identity.

### A06 — Serialize remote mutations across processes

**Evidence:** `packages/storage/src/repositories/sync-outbox.ts:130` supersedes a claimed row and resets ownership. Another `SyncService` can claim the newer intent at `apps/cli/src/services/sync/SyncService.ts:592`. The older request is still applied at `:703`; local completion CAS occurs afterward. AniList writes absolute progress at `AniListAdapter.ts:411`.

**Trigger and result:** Two services share one profile. Old episode-three delivery is held; episode four is enqueued and delivered by a second worker; the old write finishes last. Remote progress becomes three and the outbox is empty. Reproduced using two actual services and memory SQLite. The installed-version cleanup lock is not exclusive profile execution.

**Disproof:** Generation/claim protection prevents stale deletion of local rows, not stale external writes. Existing tests cover one service's concurrency and local supersession. Plan 032 already keeps sync experimental, but does not specify this ordering repair. Confidence HIGH.

**Fix and acceptance:** Separate latest desired state from in-flight delivery ownership. Use a durable per-account/tracker worker lease to serialize ordered remote writes; preserve newer intent until the older operation has settled. Do not hold SQLite transactions across network calls. A local lease cannot fence a request that an external API already accepted: define timeout/lease-takeover uncertainty explicitly and retain reconciliation work where needed. Test two independent DB handles, delayed old writes, lease recovery, process death, shutdown, progress and membership toggles. Qualify disposable-account remote behavior before promoting sync.

### A07 — Keep desktop and relay provider rosters in agreement

**Evidence:** `apps/relay-server/src/provider-registry.ts:11` includes six modules; `apps/cli/src/container/bootstrap-providers.ts:38` includes twelve. HiAnime, AnimeGG, KickAssAnime, VidRock and Movy declare relay-safe profiles but are absent from the server. YouTube's exclusion is intentional. The client port at `packages/relay/src/create-relay-fetch-port.ts:60` only directly falls back for designated auth/config failures.

**Trigger and result:** Configured relay plus an omitted provider yields 404 unknown-provider even with direct fallback enabled. Root reran the mocked client-to-real-handler HiAnime reproduction and confirmed the result.

**Disproof:** Checked missing manifests and server drift tests. Tests derive from the incomplete server list and cannot detect omitted providers. Confidence HIGH; new finding.

**Fix and acceptance:** Share application-neutral production module descriptors or enforce explicit parity with the desktop loader. Keep production authority testable without importing the CLI into another app. For every production relay-safe module, an actual client/server contract test must reach the appropriate server entry; research and non-relayable modules must remain excluded. Define version-skew behavior separately rather than adding catch-all HTTP fallback.

### A08 — Scope negative evidence to the request that failed

**Evidence:** `packages/providers/src/shared/resolve-gate.ts` skips subsequent URLs on a refused host and `dropRefusedStreams` filters that entire host. `packages/providers/src/rivestream/direct.ts:1159` consumes this result.

**Trigger and result:** Same CDN, expired/denied 1080p URL and valid 720p URL. Only the failed 1080p URL is probed; the result rejects both. Root reran this mocked reproduction. HTTP status for a path/signature/header set does not establish host-wide failure.

**Disproof:** Read the selection walk, inventory filtering and existing test asserting that a host answers identically for all rungs. That test encodes the wrong premise; different-host fallback tests do not disprove this. Confidence HIGH.

**Fix and acceptance:** Deduplicate identical request fingerprints and suppress refused stream requests, not hosts. Host-wide quarantine needs host-wide transport evidence. Same-host mixed outcomes must select the playable sibling, never reselect the rejected stream, and respect the overall deadline. Include differing signed URLs and required headers.

### A09 — Record the roster repair and strengthen behavioral gate coverage

**Initial evidence:** The initial `packages/providers/test/provider-resolve-gate-coverage.test.ts` listed eight providers, omitting HiAnime, AnimeGG, KickAssAnime and Movy. Those adapters could return success without the shared gate or an exemption. This was a P1 finding against the initial baseline.

**Current state:** Concurrent commit `9c49453f0` adds the gate to all four adapters and derives coverage from imports in `loadProductionProviderModules()`. Final reread confirms that repair, and the final provider suite passes 920 tests. Do not refile the missing-provider roster as an open defect. The remaining assertion still checks marker text anywhere in a provider directory, so stronger behavioral coverage is useful.

**Disproof:** Searched and read all four adapters before and after the repair. YouTube and Miruro have explicit runtime exemptions; those are not newly discovered violations. Miruro's measured budget residue already has a plan. Fixture passes do not establish live-provider reliability or full behavioral coverage.

**Remaining improvement and acceptance:** Retain the runtime-derived roster. Require behavioral probing or a precise runtime exemption for every adapter. Test a dead-first/live-second candidate at the actual adapter boundary, headers included. Adding a marker string must not satisfy the contract. Calibrate probe budget before imposing extra round trips.

### A10 — Preserve Android's last committed backup across retries

**Evidence:** `apps/mobile/src/runtime/android/node-state-store.ts:91` removes the previous state even when no current state exists. `application/run-mobile-application.ts:120` automatically retries persistence to record a failure.

**Trigger and result:** Activation and backup restoration both fail. The first attempt preserves previous state; the second deletes it and fails activation again. Root reran the in-memory fault reproduction. Current mobile data is host-proof counters/results, not desktop watch history.

**Disproof:** Android tests cover restoration success, not repeated restoration failure. a-Shell already preserves this case at `runtime/ashell/ashell-state-store.ts:61`. Confidence HIGH.

**Fix and acceptance:** Recover/validate any existing backup before discarding transaction artifacts. Repeated failures must preserve a readable committed state; later recovery must restore it. Reuse behavioral fault scenarios across stores while keeping platform file APIs separate. Physical-device qualification remains a separate gate.

### A11 — Validate known config fields at the disk boundary

**Evidence:** `packages/config/src/schema.ts:5` validates only providerRelay and passes through other fields. `parse.ts:15` casts that result to typed config. `ConfigServiceImpl.ts:34`, `:44` and `:61` assume string fields/members before startup completes.

**Trigger and result:** Valid JSON with numeric provider, a numeric provider-priority member, or numeric nested quality passes parsing and throws TypeError during load. Root reran all three cases against the actual parser/service with a memory store.

**Disproof:** Checked normalization and tests. Several individual fields handle wrong types, but these do not. Keeping unknown future keys is useful; claiming malformed known keys have valid types is not. Confidence HIGH.

**Fix and acceptance:** Validate known persisted keys and nested shapes while preserving unknown forward-compatible keys. Recover individual invalid fields with explicit defaults/diagnostics without resetting unrelated preferences or secrets. Test malformed arrays, profiles, partial old versions, valid unknown keys and round trips. Avoid a second independent config schema drifting from canonical types.

### A12 — Translate the whole failure union

**Evidence:** `packages/core/src/provider-cycle-engine.ts:825` produces candidate-rate-limited and candidate-server-error. `packages/providers/src/shared/provider-cycle.ts:35` omits both. Miruro and other production adapters consume this mapper when a cycle exhausts.

**Result:** Both real mapper calls return unknown, discarding information the transport already knew. Core classification tests do not exercise this conversion. Confidence HIGH; no known plan owner.

**Fix and acceptance:** Map these to rate-limited and provider-unavailable, and use exhaustive union checking so future additions fail compilation. Exercise exhausted provider results and trace failures, not only the helper. Keep retry-after/backoff and user recovery guidance tied to the typed cause.

### A13 — Enforce the envelope cap during upload

**Evidence:** `packages/relay/src/handler.ts:192` reads request.text before enforcing actual bytes. `apps/relay-server/src/relay-runtime-policy.ts:40` routes the Bun server to this handler without an explicit matching server cap. The Node adapter has a different bounded reader.

**Result:** A synthetic chunked Web request consumed 262,144 bytes before returning 413, despite the 65,536-byte contract. Root reproduced this. Exposure is the local or authorized Bun relay path; do not describe this as an unauthenticated public Vercel vulnerability. Hosting limits do not establish the shared reader's bound.

**Disproof:** Read auth-first handling, default binding policy, Node integration tests and Bun server options. Node tests do not cover this adapter. Confidence HIGH.

**Fix and acceptance:** Bound Web-stream reading and cancel the body once the byte ceiling is reached; provide a read deadline and applicable Bun server limit. Test oversized chunked and stalled upload through both adapters. Rejection must occur before upload completion, with buffering bounded by the configured limit plus a chunk, and no upstream request.

### A14 — Make docs builds account for all their inputs

**Evidence:** `apps/docs/turbo.json:5` and `:22` declare dependencies/outputs but no external source inputs or docs-specific environment variables. The generators read root docs, release material, CLI command/key metadata and provider manifests (`scripts/sync-code-metadata.ts`, `scripts/sync-repo-content.ts`). `lib/site.ts:12` consumes DOCS_SITE_URL; `lib/metadata-fingerprints.ts:79` consumes source/deployment revision.

**Result:** Two Turbo dry runs with different synthetic DOCS_SITE_URL and SOURCE_COMMIT values produced identical generate/build hashes. Neither task lists external CLI/root docs inputs or those environment variables. Strict-mode tasks can miss supplied variables and publish localhost canonicals; cacheable builds can restore output for undeclared source changes. A noncached generator does not make downstream hashing depend on its actual output contents.

**Disproof:** Checked the installed Turbo task graph and package config. Vercel's checked-in build command directly invokes generate/build:app and bypasses this Turbo route; do not claim every current Vercel deployment is affected. Confidence HIGH for missing contracts; no stale deployed page was observed.

**Fix and acceptance:** Declare precise external inputs using the installed version's root-relative input support. Declare variables that affect output in env and runtime-only variables in passThroughEnv where appropriate. Declare generator outputs and dependent build inputs consistently; retain the current provenance-sidecar behavior. Dry hashes must change for external content/config changes. A cold/warm build in an isolated checkout must produce the intended canonical origin and current command/provider tables. Add pre-push freshness coverage for repo-content outputs as well as CLI metadata.

### A15 — Reconcile lifetime counting with retirement

**Evidence:** `apps/analytics-ingest/src/postgres-store.ts:47` deletes an identity and increases a permanent retired counter; `:35` reinserts a returning identity; the rollup adds retained identities to retired count. The memory store mirrors this. `.docs/analytics-privacy-contract.md:88` promises an exact count and `:92` permanent identity storage, while later text describes pruning and a falling count.

**Trigger and result:** One identity pings, is retired, then returns. Root reproduced lifetime one becoming two in the memory store and inspected matching SQL. Existing returning-install tests return before retirement, not after. The code increases a retired aggregate rather than losing it; the documented fall-on-retirement explanation is also inconsistent.

**Disproof and confidence:** Checked store statements, prune caller, tests and the explicit UUID-to-digest upgrade double count. That documented one-time upgrade tradeoff does not cover post-retirement returns. HIGH confidence in the semantic mismatch; no real Postgres reproduction or deployed retention setting was inspected.

**Fix and acceptance:** Make an explicit product/privacy decision: retain a deduplication identity for exact lifetime counts, or publish a honestly named/defined retention-limited or estimated metric. Do not silently increase retention. Align migration, API metadata, operator docs and public privacy wording. Test return after actual retirement and repeat retirement/return; include recomputation of historical days because the global retired aggregate has no per-day first-seen boundary.

### A16 — Finish existing interaction coherence work

This is **plan 022 residue**, not three new architectural projects. Confidence HIGH by current caller inspection; no full real-terminal failure walkthrough was executed.

1. **Destructive intent:** `root-overlay-shell.tsx:1648` immediately clears the queue on plain c, while `workflows/shell-workflows.ts:2850` asks. History clear at `:1273` puts destructive Yes first; the picker defaults to index zero. Offline group deletion correctly puts Keep first. Queue restore machinery exists, so do not describe every clear as irreversible. Apply one shared arm/confirm policy across routes and preserve data by default in modal confirmations. Verify entrypoint parity and deliberate confirmation without introducing prompts on every reversible low-impact action.
2. **Filter focus:** `library-shell.tsx:287` excludes x/X/p/P from text input and routes x to deletion at `:306`. Titles such as Spy x Family and Pluto cannot be typed faithfully. Give filter/list explicit focus ownership. Type complete titles in interaction tests and assert no deletion/protection mutation while the filter owns input.
3. **Mutation feedback:** `settings/SettingsShell.tsx:139` and `:170` launch saves without handling rejection; the runtime application awaits persistence. Stats export at `ink-shell.tsx:1835` similarly lacks failure feedback. Show pending/saved/failed with a retryable draft or operation, and retain the owning surface on failure. File-write errors must not become successful copy. Test the surface with failed persistence/export ports rather than suppressing errors in storage.

### A17 — Keep the local verification promise honest

**Evidence:** `package.json:109` runs workspace format tasks in ci but omits fmt:root:check, which `fmt:check` includes at `:76`. Branch ci:affected at `:110` also omits root formatting and the standalone doc gates. The hosted Format job does check root files. `.docs/repo-infrastructure.md:154` contains a tracked conflict marker; other text still describes earlier pre-push/cache behavior. `turbo.json:13` and `:18` repeat cache false.

**Impact and disproof:** Local verification does not fully match the documented hosted gate. The duplicate JSON key currently has the same value and is cosmetic, not a claimed execution bug. Root formatting and doc-path checks passed while the conflict marker remained, showing that these gates do not detect that condition. Confidence HIGH.

**Fix and acceptance:** Align local/affected gates with intended root checks, update owning documentation and add a narrow active-file conflict-marker check. Keep generated docs verification explicit. Do not scan archived patch examples as though they were source conflicts. Decide whether warnings are advisory or release-blocking: current lint exits successfully with 20 warnings while release documentation asks for zero. Ratchet a bounded baseline rather than starting an unrelated warning cleanup.

### A18 — Preserve the selected offline artifact through the player handoff

**Evidence/reachability:** `app/offline/offline-playback-launch.ts:81` validates the requested job, but the launch carries only a title and episode coordinates. `episodeInfoFromDownloadJob` at `:34` drops provider-native identity. `app/playback/episode-playback-source.ts:38` then asks `services/offline/offline-episode-index.ts:93` for the first ready asset at that position instead of the selected job. These paths are under `apps/cli/src/`.

**Trigger/result:** Two completed jobs have the same title/S01E01 but distinct opaque provider episode IDs and files. Selecting the older original row validates it, then plays the newer replacement row. Root reproduced this with actual services, memory SQLite and two temporary nonempty files: `selectedJob=selected-old-row`, `playedJob=new-catalog-row`. Multiple profiles also permit assets at one position, though that variation was not separately run.

**Disproof:** The shelf preserves jobId and callers pass it to preparation; the next-episode helper preserves native identity. Neither repairs the launch payload's loss of authority. Existing launch/integration tests use one asset per position. This is additional residue beyond the provider-independence plan. Confidence HIGH.

**Fix/acceptance:** Carry an explicit local artifact/job reference through launch, episode selection and player handoff; revalidate that exact artifact. Preserve native identity through episode-entry transformations. Selecting B must never silently play A; if B disappears, explain that failure. Keep default profile selection separate for Continue/next launches without an explicitly selected artifact. Cover catalog churn, multiple profiles, movies/videos, both identity lanes and deleted selected files.

### A19 — Query local identity directly; paginate only presentation

**Evidence:** `packages/storage/src/repositories/offline-assets.ts:170` defaults listTitleAssets to 100 rows ordered from the earliest episode. `services/offline/offline-episode-index.ts:104` uses that page for playback lookup; counts and runway use it too. `OfflineLibraryService.ts:56` searches only after taking a limited completed list. Library shell reads 200 entries at `app-shell/library-shell.tsx:186`; the workflow picker reads 60 at `app-shell/workflows/shell-workflows.ts:145`, without older-page navigation.

**Trigger/result:** A title has 101 ready assets. The real repository returns 101 with a larger explicit limit and 100 by default. getPlayableSource says job 101 is ready, yet episode resolution returns null. Root reproduced all observations with memory SQLite and temporary files. A UI filter cannot find unloaded records.

**Disproof:** The SQL next-ready cursor can find later episodes directly, but the subsequent resolver still uses the first page. UI virtualization bounds rendering, not database coverage. Tests cover small collections; no existing owner for this exact bug. Confidence HIGH.

**Fix/acceptance:** Add indexed point queries for episode identity/job and SQL aggregates for counts. Add cursor pagination and query-before-pagination search. Do not increase an arbitrary limit or load the whole library. Test episodes 100/101/1000, multiple profiles, old matching titles and runway after a long watched cursor. Keep page validation bounded.

### A20 — Apply retry eligibility before the queue limit

**Evidence:** `DownloadService.ts:1758` reads repo.listQueued(50), then checks nextRetryAt. `packages/storage/src/repositories/download-jobs.ts:630` orders every queued row by creation before LIMIT. Pauses remain queued with future retry times.

**Trigger/result:** Fifty older deferred jobs precede a runnable row. Root reran the actual selector with memory SQLite: due work exists but selection returns null. Queue kicks repeat the same page until earlier timestamps change.

**Disproof:** Corrupt-date recovery repairs invalid timestamps; it does not exclude legitimate future pauses. Existing tests cover ordinary paused/eligible rows, not a full deferred page. No exact plan owner. Confidence HIGH.

**Fix/acceptance:** Filter eligibility before LIMIT, preserving deterministic order, time injection, corrupt-date repair and atomic claim semantics. Test a deferred page, due work beyond it, locally claimed rows and multiple workers. Idle/deferred UI should expose why work waits and what resumes it.

### A21 — Respect durable ownership in every download transition

**Evidence:** `DownloadService.ts:666` awaits storage preflight before acquiring the durable claim. Failure/low-space paths at `:675` and `:692` call repo.pause unconditionally. `download-jobs.ts:529` changes any row with that ID to queued; it does not check the prior state or ownership.

**Trigger/result:** B selects a queued job and waits on preflight. A claims and starts it. B's preflight fails and changes A's running row to queued. Root reran two real services/repositories with controlled promises, confirming the running owner, the loser's overwrite and the owner's later unfenced completion. This opens a row to another claim while a downloader remains active.

**Disproof and owner:** Queued-to-running CAS and recovery-heartbeat CAS protect their tested races. claimedJobIds is process-local and cannot protect this earlier write. Existing tests do not reorder a losing preflight this way. ADR 0003 records the broader concurrent-download risk, while its statement that both processes can claim a queued row predates the current CAS; update that explanation around this remaining seam. Its transactional-sync safety statement also needs to acknowledge A06's external ordering boundary. Confidence HIGH.

**Fix/acceptance:** Guard preclaim deferral with observed state/generation, or acquire an owned durable preflight lease. Fence heartbeat, progress, completion, retry, pause and cancellation with the claim generation. UI commands should request owner cancellation. Add two-worker late disk-error, low-space, abort and recovery tests; keep filesystem/network work outside long transactions.

### A22 — Give intermediate files an explicit lifecycle

**Evidence:** DownloadService passes `-o job.tempPath` and `--continue`, with normal yt-dlp partial behavior. Abort cleanup at `:996` and deletion at `:1065` remove only tempPath. Installed yt-dlp helpers locally confirm actual intermediate names tempPath.part and tempPath.ytdl.

**Trigger/result:** Create incomplete bytes/resume metadata at those actual names, then invoke real abort and permanent deletion. The job becomes aborted then disappears; both files remain. Root reran the fixture, using local Python yt_dlp naming helpers and memory SQLite, without network.

**Disproof:** Preserving safe partials for pause/retry is useful. The defect is announcing cleanup and removing the owner while its bytes remain. Existing mocked fixtures write directly to tempPath, omitting downloader intermediates. Confidence HIGH for these names; other format/fragment combinations still need testing.

**Fix/acceptance:** Use a job-owned staging directory or explicit intermediate manifest. Preserve partials deliberately for pause/retry; remove verified owned intermediates on permanent cancellation/deletion. Include cleanup failure and partial bytes in diagnostics. Never broad-glob a shared destination. Test real filename conventions, fragmented/merged output and multiple jobs.

## Downloads and offline: current state and next work

**The core is implemented and has substantial safety mechanisms; everyday offline reliability still has gaps in artifact selection, ownership and collection coverage.** The supplemental offline/download/YtDlp/launch/integration selection passed 332 tests across 39 files. This is fixture evidence, not an actual transfer or playback signoff.

| Area        | Current implementation                                                                                                            | Practical boundary                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Intent      | Opt-in admission; confirmed profile; canonical/opaque episode identity; database duplicate protection; fresh intent re-resolution | New acquisition still needs a working provider/extractor                                                                        |
| Queue       | SQLite jobs; claim CAS; heartbeat/recovery lease; configured 1–5 parallel workers; bounded fragments/socket/retries               | A20/A21 expose gaps outside the protected claim                                                                                 |
| Publication | Short sibling temp name; validation; exclusive hard-link publication; owner-conflict checks; crash adoption without redownload    | Unsupported hard-link filesystems fail safely; without ffprobe, validation proves a nonempty regular file, not decode integrity |
| Repair      | Bounded optional ffprobe; local duration/size/timing; sidecar-only repair; best-effort artwork cache                              | Missing subtitles/artwork remain distinct from video failure                                                                    |
| Playback    | Exact local-path trust; unified mpv lifecycle; history/resume; local next cursor; local-only errors                               | A18/A19 can select the wrong copy or fail to find one; provider registration still gates playback                               |
| Storage     | Reserve checks; disk-full deferral without spending attempts; shutdown pause; bounded termination                                 | A04/A22 lose cleanup truth; freeing space does not trigger a queue pass                                                         |
| Runway      | Explicit title enrollment; bounded deficit from cached releases; streaming does not silently enroll downloads                     | Needs cached history/release/source facts; no fresh acquisition while disconnected                                              |
| Quit/mobile | SQLite work resumes next session; mobile has portable host-proof state/player ports                                               | No detached downloader daemon or shipped mobile offline library                                                                 |

**Provider independence remains planned, and code confirms the gap.** Offline launch restores job.providerId. `PlaybackPhase.ts:1104` returns PROVIDER_UNAVAILABLE before local resolution at `:1639`. A readable download can become stranded when its provider disappears. Promote the existing [provider-independence plan](./offline-provider-independent-playback.md) together with A18. Resolve a discriminated local/provider source authority before provider admission; preserve unified lifecycle, exact-path trust and offline-only failure behavior.

**Make the architecture slice small.** The existing [boundary/adaptive-download plan](./boundary-hardening-and-adaptive-downloads.md) owns queue/admission/transition orchestration, job resolution, process/argv/progress/termination mechanics, artifact validation/publication/owned cleanup and pure capacity/failure policy. Keep these in CLI services/infra until a second real surface needs them. Parallel workers and protected publication already exist despite plan text describing them as future work; reconcile that plan first. Characterize ownership races before extracting the 2,000-plus-line service.

**Remove capability scaffolding without a reader.** OfflineMaintenanceService is constructed/exported, but production has no callers of scheduleForAsset/processNext and no optional-operation handler is wired. Actual repair uses DownloadService. OfflineLibraryService.savePlaybackHistory also has no runtime caller; unified playback owns history. Wire a concrete owned workflow or remove/defer these unused abstractions instead of maintaining apparent second authorities.

**Show useful local facts and actionable outcomes.** Include verified playable count, selected profile, cached subtitles, partial/staging bytes, free/reserved space and distinct queued/running/deferred/repairable states. Say “video playable; subtitle repair pending.” Use typed failure reasons instead of looking for “space” in message text. Handle action promises with pending/success/failure feedback. Existing percentage-derived ETA is an estimate; unknown-size HLS needs honest presentation. “Quit and keep downloads queued” explicitly resumes on next launch rather than promising background progress. Check the destination's safe-publication capability before a long transfer; unsupported hard links currently fail at publication after the bytes were downloaded. Preserve the no-overwrite rule.

**Next acceptance gate:** Download owned test media; interrupt/restart and reuse safe partials; remove the recorded provider; disconnect networking; play the selected exact artifact with local subtitles/timing; resume/autoplay downloaded next episodes; test more than 100 episodes and two copies at one position; simulate full/unavailable disks and failed deletion; quit/reopen and inspect staged files. Run Linux, then native Windows/macOS. Mobile needs its own physical storage/background/player capabilities. The existing offline-beta smoke is a useful starting harness but was not run here.

## Architecture and deslop: what to change without growing another framework

### Preserve the existing dependency direction

The executable package/layer tests are more valuable than another architecture diagram. Keep types/design independent; schemas validate untrusted data; config owns persisted shape/defaults; core owns provider/cycle policies; provider adapters own extraction; relay owns checked metadata transport; storage owns durable transactions/repositories. App composition supplies ports; services adapt I/O; domain rules remain pure; the shell renders and owns interaction.

A service should expose an operation with its observable outcome rather than return internals the shell must interpret across several files. A pure module should expose the policy result rather than read config, call APIs and render copy. Prefer classes for genuine owned lifecycle/state, such as a player session; prefer pure functions for decisions. A class that merely forwards every method has no automatic architectural value.

| Repetition or smell                         | Evidence                                                     | Meaningful simplification                                                |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Multiple production-provider rosters        | A07, A09, docs generator's provider-name maps                | Share descriptors/parity tests; keep per-app capability policy explicit  |
| Mobile transaction-policy copies diverge    | A10; a-Shell already protects repeated failures              | Shared behavioral contract fixtures, platform-specific adapters          |
| Typed config inferred from unvalidated data | A11                                                          | One known-field schema/normalization boundary, unknown-key compatibility |
| Auth refresh used for new-token admission   | A05                                                          | Separate tolerant established-session refresh from candidate validation  |
| Per-function stale-operation checks         | A03                                                          | Cycle-owned lifecycle operations with checks after every await           |
| Failure unions lose meaning at translation  | A12                                                          | Exhaustive typed mapping; preserve code and retry policy to the UI       |
| Huge phase/shell files mix responsibilities | Existing plans 010–015                                       | Characterization tests, then narrow lifecycle/workflow extraction        |
| Duplicate recovery budget defaults          | mpv-session-lifecycle.ts:8 and playback-source-failover.ts:6 | One domain policy owner when recovery is next touched                    |

PlaybackPhase is about 4,700 lines, shell workflows about 3,300, Ink shell about 2,300, and the persistent mpv session about 1,800. Size identifies review cost, not a measured performance defect. A03 shows the actual architectural problem: asynchronous work can outlive its owner and mutate its successor. Finish the existing behavioral harness and extract around ownership, not arbitrary line-count targets.

The two stream caches have distinct resolve-time/durable purposes and should not be merged merely because their names resemble one another. Likewise, browser/runtime adapters, metadata relay and direct media paths have genuinely different contracts. Shared abstractions should remove a repeated invariant; they should not conceal those differences.

Before adding a helper, class, capability or package, identify its consumers, lifecycle owner, failure outcome and likely second use. Remove dormant speculative mechanisms only after checking exported callers, roadmap intent and tests. Do not add a package for each small helper or a generalized plugin system to avoid maintaining twelve explicit adapters.

### Persistence and concurrency design

Separate intent, ownership and evidence of completion. Downloads need a durable owner until publication/removal completes. Sync needs desired state independent of an in-flight mutation. Authentication needs candidate identity independent of the committed account. Playback needs generation identity independent of whatever is currently displayed.

Keep network calls outside storage transactions. Use transactions for related durable changes, claim/lease CAS for ownership, explicit state transitions for retry, and fault-injection tests for every crash boundary. Advance visible success only when the relevant durable or runtime boundary confirms it. Avoid treating cancellation, timeout and absence as interchangeable fallbacks.

Revalidate and execute existing plans 044/045 for identity/reference migration; do not invent another migration track. Copy real profiles into a one-way shadow sandbox when qualifying migrations, never point tests at live SQLite. Add restore/readback and concurrency acceptance to migration work rather than relying on successful schema creation.

### Provider and connection design

Keep global provider fallback distinct from local source/quality fallback. Define each attempt's total time budget, candidate budget, request retries and cleanup ownership. Deduplicate identical work within that budget; do not multiply retries at every layer. Record negative evidence at the narrowest justified scope: request, source, endpoint or provider. A08 is a concrete example of overreach from request-level refusal to host-wide rejection.

Keep user-selected provider/preference separate from temporary recovery choice. Preserve truthful states: discovered, probed, inconclusive, verified, handed off, started, recovering and failed have different meanings. Existing tolerant probe behavior is documented; changing it requires measured budgets and clear attestation, not an indiscriminate hard-fail policy.

Use local structured diagnostics for latency, cancellation, source attempts and recovery reasons. Do not expand the five-field analytics payload with titles, provider URLs or per-user playback data. User-facing text should say what happened, whether progress/data was retained, and the next useful action; detailed traces belong behind Diagnostics.

## Everyday product and UX direction

1. **Complete the continuity loop.** Existing canonical boards prioritize Continue watching and one Resume action (`.reference/design/cli/kunai-sakura-canonical.html:226`). History, queue and local availability already exist. Make launch → trustworthy resume → confirmed start → saved progress → next episode predictable, with clear local/online availability. No automatic playback or new discovery surface is necessary. Measure time and keystrokes to confirmed start in a sandbox.
2. **Make recovery understandable.** The canonical recovery surface retains progress and one primary action (`:413`). First fix A02/A03, then present the current state and recommended Recover/Change source action without requiring provider knowledge. State when a lower quality or another provider is being tried. Measure recovered playback at the saved position, not number of attempts.
3. **Make settings and destructive actions trustworthy.** Finish A16 with visible focus, preservation defaults, accurate save/deletion outcomes and consistent Esc/back. Keep established design tokens and canonical terminal layouts. Add narrow-terminal, no-image, multiplexer, keyboard-paste and actual advertised-key checks before cosmetic animation work.

These are completions of existing product direction, not requests to build web accounts, recommendations, payments or a new branded shell.

### Mobile scope and next gate

`apps/mobile` is a host-proof preview: terminal choice, bounded HTTP, atomic proof state and external VLC handoff. Search, catalog, providers, episode/source selection and observed playback progress are explicitly absent from the current app. The existing docs are honest about that scope; compiled artifacts or accepted VLC intents are not evidence of watched media.

Repair A10 and qualify real Android ARM64 Termux/VLC and iPhone a-Shell/VLC behavior before extending mobile. Include background/resume, cancellation, state recovery, URL/header handoff and return-to-terminal observations. Preserve the portable application ports and strict iOS runtime graph restrictions. Share serializable contracts and suitable pure policies, not desktop Ink/SQLite/mpv internals. External-player capability must determine which progress/resume claims the UI can make.

## Performance, production and monorepo practices

**Measure before restructuring startup.** Existing plans 060 and 008 own first-paint attribution and shell/subscription work. Capture cold/warm medians and tail timings for capability probe, vault/storage/container setup, first render, resolve, confirmed playback start and recovery. Full-session root subscriptions are a candidate for selector narrowing, not proof of a current latency regression. In-flight poster coalescing is a low-priority investigation until simultaneous same-key work is reproduced; current poster byte/cache bounds are a strength.

**Scale bounded work first.** Bound request bodies while reading, concurrent provider attempts, cache entries/bytes, subprocess lifetimes, background jobs and paginated library views. Deadlines must cover body consumption as well as headers and must cancel the underlying work. For a local CLI, responsiveness and predictable resource use matter more than adding distributed services. Analytics' global admission row bounds retained data, not all request/compute costs; inspect deployed firewall/rate rules and budget alerts separately before claiming denial-of-wallet protection is complete.

**Use installed Turbo semantics.** The installed package is 2.11.5; its bundled task/env/input docs were read. The graph uses source packages and transit nodes; do not impose unnecessary build steps or declarations copied from another Turbo version. Keep declared workspace dependencies/exports aligned with actual imports and runtime boundaries.

Specific practices worth adopting:

- Fix A14 with package-specific external inputs, outputs and environment contracts. Validate dry-run selection/hash behavior, then cold/warm artifact restoration in an isolated checkout.
- Keep noncacheable release/behavioral verification explicit. Current lint, test and typecheck tasks bypass cache; avoid recommending a cache-disable change that already exists. Cache deterministic build outputs only when inputs and artifacts are complete.
- Keep the zero-affected fallback and CI-ready aggregate. Validate routing with representative root-only, docs-only, mobile-only, provider-registration and shared-contract changes. Align pre-push root checks with hosted checks.
- Make composite-action dependencies reproducible. Top-level release actions are SHA-pinned, but setup-bun-monorepo still uses mutable setup-bun/cache tags. Pin that transitive action chain and maintain it deliberately; this is supply-chain hardening, not evidence of a compromised release. [GitHub's guidance](https://docs.github.com/en/actions/reference/security/secure-use?learn=getting_started&learnProduct=actions) explains immutable SHA references.
- Preserve candidate-byte verification, native attestations, protected publication, exact asset contracts and metadata PRs. Verify the actual GitHub environment reviewers, branch checks and provenance policy remotely; YAML alone cannot prove enforcement.
- Complete native Windows/macOS acceptance for changes that touch file replacement, sockets, locks or packaging. Local Linux pass, cross-compilation and checksum verification are separate evidence.

The docs-specific input/env recommendation follows the [official environment guidance](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables) and [cache guidance](https://turborepo.dev/docs/crafting-your-repository/caching), with the installed bundled docs taking precedence for version-specific syntax. No Turbo configuration was changed here.

## Testing and engineering workflow

Passing tests are useful, but several defects here arise from the test's model being narrower than production. Prefer observable outcomes at seams:

- Player: deliberately reorder stop/next/reconnect acknowledgements and assert promise ownership, event identity, progress and cleanup.
- Provider: dead and live sibling requests on the same host; headers/signatures, timeout/cancel and actual module roster coverage.
- Storage: repeated activation/restoration failures, delete failure/retry, two workers/DB handles, crash/lease recovery and full reference migration.
- OAuth: failed replacement identity with a previously connected account, persistence rejection and cancel after the browser returns.
- UI: advertised keys actually work; text focus never triggers row mutation; save/export failure remains visible; confirmation defaults preserve data.
- Transport: run private-DNS, redirect, byte-limit and deadline contracts through the real wrappers rather than isolated fetch mocks alone.

Use injected clocks and controlled promises; do not patch failures with sleeps or ever-larger timeouts. Do not assert another platform's path spelling or permission behavior. Retain real sockets/IPC, disposable Postgres, native installer and physical-player checks where mocks cannot prove the boundary. Static source scans should ratchet layering and roster coverage, not substitute for behavior tests.

For each future change, require a short review description naming the consumer, inverse/readback behavior, every entrypoint, anime/TMDB decision, adapter/platform decision, owning doc and success evidence. A new setting without a reader is unfinished. A refactor should have a measurable reason: fewer policy copies, fewer affected files per change, clearer lifecycle ownership, faster measured path, or a repaired behavior.

Documentation already has strong routing, vocabulary and ownership. Keep one canonical explanation per subsystem. Update owner docs alongside contract changes, derive public tables from executable authority, and keep unfinished plans indexed only in the roadmap. A concise first-journey contribution walkthrough can link feature map → domain policy → service/port → test → runtime evidence; do not create another parallel standards system.

## Recommended execution order

1. **Finish the new security guard's remaining boundaries.** The concurrent patch landed and its provider suite passed; complete A01's wrapper/deadline/media-relay cases and qualify actual HTTPS/provider behavior.
2. **Repair playback trust:** A02 and A03 with deterministic regressions. Include real mpv buffering/recovery after local gates.
3. **Repair data, accounts and offline truth:** A04, A05, A10, A18 and A21 first. Preserve the exact selected artifact, promote the existing provider-independent local-playback plan, and fence download ownership. Then A19/A20/A22 for complete lookup, queue fairness and owned partial cleanup. Update every UI caller and preserve failed-operation ownership.
4. **Restore provider contract parity:** A07, A08, A09 and A12. Check every production adapter and measure changed probe budgets.
5. **Keep sync experimental** while A06 and existing 044/045 identity work are reviewed/qualified. Land two-worker characterization before changing the outbox protocol; qualify a disposable account afterward.
6. **Harden boundaries:** A11 and A13; fix A14's build contracts; resolve A15's product/privacy semantics before changing identity retention.
7. **Complete plan 022 UX slices**, then measured extraction/performance work under the existing architecture and 060/008 plans. Include A17 in routine infrastructure maintenance.

Do not start every item in parallel. Freeze shared types/config/schema and storage ownership before concurrent implementation. Each change should have explicit allowed files, baseline commit, acceptance scenarios and owner docs. This report contains fix sketches and acceptance criteria; it does not replace the existing detailed plans or authorize production mutation/publication.

## Verification recorded in this audit

| Check                                                  | Result and boundary                                                                                                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI/mobile and all shared/service-package typechecks   | Passed via direct per-package scripts; docs typecheck:app also passed                                                                                                                           |
| Root lint with force                                   | 14 tasks executed, zero cache replays; CLI had 20 warnings, zero errors                                                                                                                         |
| Root fmt:check                                         | Initial failure on five in-progress provider-test files; after concurrent commits, all 13 package checks passed. Only this new report needed formatting, which was applied to this report alone |
| Root fmt:root:check                                    | Passed for the finished report and roadmap; no source files formatted by the audit                                                                                                              |
| Doc paths                                              | Passed on final source: 58 docs and 2,316 source files scanned                                                                                                                                  |
| CLI architecture/analytics/CI-contract selection       | 131 passed, zero failures, 15 files; shadow storage roots                                                                                                                                       |
| Types, schemas, core, config, relay, storage suites    | 20 + 12 + 119 + 8 + 118 + 207 passed; 484 total, zero failures                                                                                                                                  |
| Design package                                         | No test script; contracts have cross-package token coverage; not a failing unit suite                                                                                                           |
| Provider suite                                         | During edits: 887 passed, one skipped, 14 failed. Final isolated rerun at a1849a389: 920 passed, one skipped, zero failures; direct provider typecheck passed                                   |
| Mobile unit selection                                  | 103 passed; host proof only, not physical playback                                                                                                                                              |
| Existing desktop lifecycle/watchdog/selector selection | 39 passed; two additional intended-behavior regression assertions failed as reported in A02/A03                                                                                                 |
| Supplemental offline/download/YtDlp/launch integration | 332 passed, zero failures, 39 files; memory/temp storage and mocked processes                                                                                                                   |
| Additional downloader/storage executor contracts       | Audit worker: 7 process-executor and 13 storage admission/identity tests passed; its 154 download tests overlap the 332-test selection                                                          |
| Config/AniList/Sync selected existing tests            | 97 passed, six filtered out; separate initial OAuth listener attempt hit sandbox socket restriction                                                                                             |
| Analytics ingest suite                                 | 121 passed, 33 skipped; listener setup failed with sandbox EPERM; Postgres tests were not executed                                                                                              |
| Root-controlled reproductions                          | Confirmed A01's 1 ms lookup timer, A02/A03, A05/A06/A08/A10/A11/A12/A13/A15 and A18–A22; A04 Linux permission fixture independently reproduced by audit worker                                  |
| Dependency advisory lookup                             | Initial DNS failure; escalation rejected by automatic approval review because it exports package metadata to npm                                                                                |

The full root test/build/release gate was not executed. Formatting checks replaced mutating formatting; direct typechecks avoided generators rewriting tracked docs. Logs and controlled reproduction files are under `/tmp/kunai-audit-*` and `/tmp/kunai-*-audit-repros.ts`; they are disposable session evidence, not maintained test coverage. Before calling any implementation complete, add durable relevant regressions, rerun fresh required gates, and qualify the external/native boundary that changed.

## Considered and rejected or already owned

- Green static architecture tests do not imply uncovered runtime provider probes; A09 identifies the specific gap rather than alleging all tests are useless.
- The whole codebase does not need a new dependency injection or provider framework. Existing seams need clearer ownership and behavior tests.
- Deliberate tolerant network refresh, commented cleanup silences, standard proxy conventions and isolated test credentials were not automatically classified as security bugs.
- No hardcoded production secret or malicious source prompt was confirmed in the reviewed paths. This is not a secret-scan attestation of the full Git history.
- Existing provider cache layers are intentionally distinct. Their duplication was rejected as a finding.
- Miruro's recorded probe exemption, startup profiling, giant-file extraction, history namespace/reference migrations, and plan 022 were not refiled as new work.
- Earlier gate DNS/media-relay evidence was reconciled with the landed concurrent repair. A09's roster/gate omission was fixed by other work; A01 records only the remaining wrapper/deadline gaps. A transient missing export during those edits was not filed as a permanent defect.
- A passing mobile build, accepted VLC handoff, or host-proof unit test was not presented as physical support.
- Unpinned composite actions, missing dependency advisory results and uninspected hosting policy were described as hardening/verification limits, not evidence of compromise.
