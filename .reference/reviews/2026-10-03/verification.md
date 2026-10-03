# Verification of the local repair candidate

Baseline: main `e509732e7cdd3277943b7a705a0fea9004ed0b7f`.
All commands ran in `.worktrees/full-review-fixes-20261003`, with temporary
HOME, USERPROFILE, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_CACHE_HOME, APPDATA and
LOCALAPPDATA under `/tmp/kunai-full-review-20261003/profile-fixes`. The Bun install
store was independently owned under this audit's temporary cache. No test
used KUNAI_CONFIG_DIR or migrated the real user profile.

| Gate | Observed result | Limits |
| --- | --- | --- |
| `bun run test --force --concurrency=2` | 26 tasks successful, zero cache replay; **8,097 pass, 60 skip, zero fail** | Skips are optional/external/platform suites; see below. |
| CLI unit | 5,800 pass, 1 skip | Linux fixture execution, not macOS/Windows qualification. |
| CLI integration | 295 pass, 25 skip | Includes actual pwsh available on this host; actual Windows runtime still separate. |
| Mobile | 138 pass | Node/emitted-artifact and mock JSC host proof; no physical phone. |
| Docs | 293 pass | No browser visual/accessibility qualification. |
| Storage | 209 pass | Includes transaction rollback and tied-timestamp due cursor regression. |
| Providers/core/relay | 901 / 119 / 118 pass; providers 1 skip | Fixture contracts, not live uptime for all providers. |
| Analytics ingest | 133 pass, 33 skip | Hosted Postgres/external fixture gates not run. |
| Relay-server/types/schemas/config | 51 / 20 / 12 / 8 pass | Local fixture checks. |
| `bun run typecheck --force`, lint, fmt/check | Pass; lint zero errors, existing warnings retained | Executed fresh. Formatter-only hunks reviewed; no correctness rule disabled. |
| Doc paths/frontmatter/parity | Pass; 57 routing docs, 2,323 source paths; 81 doc frontmatters reconciled | ani-cli local freshness skipped because checkout absent. Hosted doc coverage not executed locally. |
| Anti-slop baseline + release guard | 4,413 findings; baseline ratcheted down one, no increases; version guard passes | Existing debt remains; no claim zero lint debt. |
| `bun run build --force` | 10 tasks, zero cached; Linux-x64 artifact 80.6 MiB | Host build does not certify all supported targets. |
| `bun run build:docs --force` | 5 tasks, zero cached; Next 16.3.8 production build passes | Actual deployed browser/provider behavior not qualified. |
| `bun run verify:build-pipeline:pr` | Host pack/launcher, cache restore check, Linux glibc+musl compile and partial two-target assets pass | This deliberately tests caching; forced build performed separately. Full eight-target/18-file release set remains. |
| `bun run test:binary:smoke` | 13 pass, 1 skip | Exact host binary; full release-set assertion intentionally skipped. |
| `KUNAI_REAL_MPV=1 bun run --cwd apps/cli test:agent` | 10 pass, zero fail; generated local media advances mpv IPC and history row | Local loopback fixture, not a third-party stream or physical phone. |
| Fixture CLI + real tmux restart | Enqueue frame and backend cite check pass; same pending row survives relaunch | Fake provider/player for this interaction; separate real-mpv tier above. |
| `bun run test:live:allmanga-crypto` | HTTP 200, diagnosis current, build 177, epoch 2960 vs live 2961 | Metadata bootstrap only; no video or full provider health claim. |
| `bun audit --json` | **Not clean:** braces GHSA-vfj7-8cjw-p6xm, no patched version available when checked | Development-tool paths; tracked Bun patch now verified under Bun/Node, with no ignored advisory. |
| React Doctor 0.9.14 changed vs HEAD | Complete CLI/docs eligible-file scan: zero new errors, three warnings | Full baseline has 15 errors/181 warnings; different scopes are not comparable scores. |

The complete root run took 2m16.932s on this machine. This is a measured
execution duration, not a CI cost/speedup promise. Earlier restricted-sandbox
loopback tests failed, and earlier sequential unisolated mocks contaminated
other files; matching baseline and isolated runs distinguished those causes.
A later parallel rerun exposed one timestamp-tie test assumption. It was
corrected with explicitly ordered fixture timestamps and a separate durable
cursor regression; the final full graph above passes after that correction.

The compiled fixture passes movie/series/anime persistence, exact queue claim,
failed handoff restoration, shutdown restoration, persistent loadfile reuse
and return to shell. Those are stronger than typecheck, but remain fixture
proof. Actual region/provider availability, hosted CI on the integrated PR
head, physical terminals, native installer Docker matrix, exact npm candidate
publication and physical iOS/Android qualification remain release gates.

## Captured interaction evidence

The driver verified `Added Smoke Movie (2026) to Up Next` and
`tmdb:smoke-movie-1` via its citation checker in one evidence run; see
[queue-drive-verified.txt](queue-drive-verified.txt). Config stayed
`"analytics": "disabled"`, with `"installId": ""` in the original drive.

The real terminal run's SQLite record before and after relaunch is identical:

```json
{
  "id": "e6022b5d-e29d-4f9d-9a14-fc9c2bac07f0",
  "title_id": "tmdb:smoke-movie-1",
  "status": "pending",
  "last_failure_json": null
}
```

See [before](pty-queue-before.txt) and [after](pty-queue-after.txt). The
audit-owned tmux session was stopped and its throwaway profile removed.
This establishes durable row survival; it does not assert a rendered
post-relaunch Up Next screen that was not captured.

## PR defects versus local green

Current captured PR540 `4093fcfeea` has **three deliberately failing
reproductions**, with eleven passing controls: hostname re-resolution after
DNS preflight, fail-open DNS errors, and foreign JSON deletion. Those red
checks are outside the local candidate's default tests and apply to the
unmerged PR snapshot. No packet was sent to a private target. The local
Uninstall regression is green, while the stack's networking work remains.

PR544's adjacent TERM/KILL fixture has a passing TERM-only control; all ten
adjacent-signal trials exit by SIGKILL without running the handler on this
Linux host. That disproves a guaranteed graceful-reaping claim, not every
possible process-tree behavior on every platform.

Full temporary log hashes and suite counts are in
[verification-receipts.json](verification-receipts.json); bounded extracted
receipts are preserved beside it. Production, accounts, registry trust,
merges and deployment were not modified. Commits and PRs were subsequently authorized; mobile PR #554 is open.

## Authorized follow-up

After commit/PR authorization, the full root graph was executed again with
`--force --concurrency=2`: 8,097 passed, 60 skipped, zero failed, 26 successful
tasks and zero cache replays (2m12.378s). Fresh typecheck/lint/format/docs/guard
and CLI build also passed. Mobile commit `7de2abaf2` is PR #554; CLI runtime
repairs are commit `021a73a24`.

The braces patch is based on upstream PR 72 revision
`d0d575e55e74a4e0218e5248fafb79efc3e54ebb`, retaining existing stringify parent
semantics. Fifteen consumer-path contracts failed unpatched and pass patched
under Bun and Node. A separate clean fixture `bun install --frozen-lockfile`
passes the same checks. Turbo's dry run includes the patch in global inputs;
the CI store key also hashes patch contents. Registry audit remains red for
3.0.3, as recorded in [follow-up evidence](follow-up/).

A six-artifact Android/iOS transfer kit was built and checksummed locally.
Both evidence templates remain intentionally unpassed and the existing matrix
validator rejects them. No attached phone was visible; no physical playback
result was invented. Host integration results and build digests cannot fill
those rows. No store submission is possible from terminal-host artifacts.
