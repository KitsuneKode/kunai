# R05 — Transactional account state, ordered sync and tolerant config

Status: AUTH/CONFIG READY; STORAGE WAITING FOR R03/R04; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Reject invalid replacement credentials, prevent remote progress regression, and start safely with malformed persisted fields.
**Architecture:** Adapter validates candidate credentials before commit; durable outbox separates desired state from in-flight state and serializes a tracker/account's requests; config schemas sanitize known fields without erasing unrelated preferences.
**Tech stack:** TypeScript, Zod, SQLite, OAuth loopback, controlled HTTP ports.
**Spec:** Audit A05/A06/A11; [tracker sync](../.docs/tracker-sync.md), [plan 032](./032-sync-identity-and-capability-truth.md), [concurrent ADR](../.docs/adr/0003-concurrent-instance-state-ownership.md).
**Dependencies:** R05.1 auth and R05.3 config can start independently.
R05.2/R05.4 require R03/R04 storage/migration freeze. Disposable-account mutation
requires explicit authorization.

## Review focus

1. Bad/aborted replacement token cannot inherit an old user ID or unpark reauth.
2. Desired progress changes do not release an outstanding remote mutation's ordering ownership.
3. Crash/lease expiry with ambiguous remote completion cannot be claimed as exactly-once delivery.
4. Malformed known config values default locally; unknown keys and valid preferences survive round trips.
5. Identity migrations repair every reference across anime/TMDB lanes and preserve ambiguous data.

## R05.1 — Validate credentials before replacing state (A05)

Allowed edits: `apps/cli/src/services/sync/AniListAdapter.ts`, existing AniList/auth/OAuth unit tests; token store port only with coordinator approval.

- [ ] Existing account has token/user 42 and needs-reauth work. Replacement Viewer's request returns 401, malformed payload, another-account response, abort or network failure. Assert no token write, no false connected result, no queue unpark and unchanged prior account state.
- [ ] Fetch Viewer using the candidate token in local variables; validate response identity explicitly. Do not assign accessToken/userId before validation or use refreshUsername's best-effort startup fallback to validate credentials.
- [ ] Thread connect's AbortSignal through validation. Treat intentional account switching as explicit verified replacement; define which old-account queued work is parked/invalidated before delivery.
- [ ] Persist a validated token record, then update adapter state and return connected. If storage fails, preserve the prior state and report failure. Test disconnect/readback and startup refresh semantics separately.
- [ ] Do not log tokens, callback secrets or raw provider error bodies. Test redacted diagnostic output.

## R05.2 — Order remote mutations durably (A06)

Allowed edits: `packages/storage/src/repositories/sync-outbox.ts`, reserved migrations, `apps/cli/src/services/sync/SyncService.ts` and reconciliation helpers; storage/CLI sync tests. Keep plan 032's experimental qualification gate.

- [ ] Use two SyncService instances and two SQLite connections. Hold E3's remote request; enqueue E4; drain worker B; release E3. Assert E4 is sent only after E3 settles and final remote progress is 4. Verify both local outbox and fake remote state, not only row generation.
- [ ] Separate latest desired payload/generation from immutable in-flight payload/claim. Enqueue may supersede desired state but must not reset ownership of an already-sent request.
- [ ] Serialize requests per canonical tracker/account identity using durable ownership. Renew ownership during active delivery; only its holder may acknowledge/fail/release. Preserve bounded retries and fairness across independent accounts.
- [ ] After E3 completes, transactionally retain desired E4 pending, then deliver it. Coalesce genuinely unsent intermediate states. Distinguish progress updates from other operations that have different ordering semantics.
- [ ] Test request rejected, timeout with unknown server completion, process death, lease expiry, account replacement and restart. A local CAS cannot fence an already-running remote server mutation.
- [ ] Define a conservative uncertain state: pause delivery and reconcile remote state or require explicit repair before claiming convergence. If the tracker offers no fencing/idempotency/ordering proof, document the limit; do not declare lease expiry alone safe. Never turn uncertainty into an automatic destructive account overwrite.
- [ ] Run an explicitly authorized disposable-account smoke through production container→SQLite→restart→remote readback. Keep experimental status until this and uncertain-completion policy are qualified.

## R05.3 — Field-level persisted config validation (A11)

Allowed edits: `packages/config/src/schema.ts`, `parse.ts`, `defaults.ts` in that package; `packages/config/test/config.test.ts`; `apps/cli/src/services/persistence/ConfigServiceImpl.ts` and existing persistence tests.

- [ ] Feed provider=4, providerPriorities=[4], playbackPreferences with numeric quality, malformed relay and valid unrelated preferences into parse/merge and real ConfigService startup. Assert no crash, invalid known fields default, valid siblings and unknown future keys survive.
- [ ] Validate every known field, including nested objects/arrays, using current types/defaults. Sanitize individual invalid paths rather than dropping the entire config object.
- [ ] Preserve forward-compatible unknown keys. Round-trip parse→merge→save→reload; migrations and invalid-value diagnostics must not expose private values.
- [ ] Verify no new analytics identity/consent arises from a missing/bad value. Enabled requires the existing explicit consent contract; corrupt consent fails closed.
- [ ] Keep atomic/debounced writes and metadata behavior; test competing save/read changes with current contract. No automatic real-profile migration during tests.

## R05.4 — Finish existing identity/reference plans

Execute [044](./044-namespace-mal-history-keys.md) and [045](./045-repoint-title-id-references-on-merge.md) only after drift checks; they remain implementation owners.

- [ ] Shadow-copy representative data and count every old/new reference before migration. Review history/list/watch-ledger/offline/download/reconciliation/outbox references and collision/ambiguous identity cases.
- [ ] Run migrations twice; require idempotence and retained ambiguous rows. Test anime MAL/AniList/provider identity and TMDB movie/series identity independently.
- [ ] Integrate migration sequence after R03/R04; record backup/forward-repair procedure. Do not migrate the real profile or promise that dropping columns is reversible.

## Verification and closure

```sh
bun run --cwd packages/config test
bun run --cwd packages/config typecheck
bun run --cwd packages/storage test
bun run --cwd apps/cli test:file -- test/unit/services/sync test/unit/services/persistence
bun run --cwd apps/cli typecheck
```

Update tracker/config docs, plan 032 qualification residue and ADR0003. Run runbook gates. Return candidate-token failures, remote final-state ordering evidence, malformed config round trips, migration before/after counts and explicit external limits.
