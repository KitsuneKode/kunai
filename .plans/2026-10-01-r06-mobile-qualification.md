# R06 — Mobile state preservation and physical host proof

Status: READY FOR ASSIGNMENT; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Preserve the last valid mobile state across repeated failures and ship only device-demonstrated capabilities.
**Architecture:** Mobile application uses its runtime ports and sole mobile entrypoint; platform adapters own terminal, HTTP, files and player handoff. Desktop runtime remains separate.
**Tech stack:** Android Node host/Termux, iOS a-Shell, TypeScript host build artifacts and device evidence CLI.
**Spec:** Audit A10; [mobile runtime](../.docs/mobile-terminal-runtime.md), [device lab](../.docs/mobile-device-lab.md), [mobile owner](./mobile-app-runtime.md).
**Dependencies:** Independent state/qualification work. Future shared config uses R05's frozen contract.

## Review focus

1. Failed activation plus failed restoration plus retry never destroys the only valid backup.
2. Android/iOS error/cancel paths preserve validated state and settle application work.
3. Build portability and VLC intent acceptance are reported separately from physical playback.
4. HTTP/config/URL construction rejects injection and credentials leaking to shell output.
5. Capability messaging matches the actual host; offline desktop features are not assumed mobile features.

## R06.1 — Repeated atomic-state failures (A10)

Allowed edits: `apps/mobile/src/runtime/android/node-state-store.ts` and `apps/mobile/test/unit/runtime/android/node-state-store.test.ts`. Extend a-Shell parity tests only if a new shared behavior is chosen.

- [ ] Extend fakeRuntime with independently failing tmp→current and previous→current moves. Commit valid state 4; fail both activation and restore for state 5; retry commit with activation still failing. Assert previous still decodes to state 4.
- [ ] Test load recovery after that sequence, invalid tmp, invalid current/backup, remove failure and interrupted cleanup. Do not silently manufacture an empty default when recoverable state exists.
- [ ] Remove previous only when a valid current is actually available to replace it, or after validated activation succeeds. Keep the a-Shell preservation rule as parity evidence; share a pure state policy only if it reduces duplication without merging distinct filesystem mechanics.
- [ ] Preserve permission modes on POSIX and platform-specific rename behavior. Surface restoration/cleanup failure without deleting the last recoverable copy.
- [ ] Exercise concurrent commit policy: serialize within a store, or document/reject unsupported concurrent writers with evidence. Do not imply process-wide locking from an in-memory mutex.

## R06.2 — HTTP, cancellation and connection failures

Allowed edits: `apps/mobile/src/application`, `apps/mobile/src/runtime/android`, `apps/mobile/src/runtime/ashell` and their tests, tightly scoped to demonstrated defects. No import from apps/cli.

- [ ] Characterize DNS failure, offline host, timeout, malformed response, TLS/certificate failure, denied filesystem access and explicit cancel. Use injected HTTP/clock/terminal ports.
- [ ] Bound request/body/redirect work using the current runtime contract. User input and stream metadata stay out of interpolated shell commands; curl config escaping remains tested.
- [ ] Retry only transient, idempotent operations under one deadline and cancellation owner. Authentication/invalid-input failures need an actionable explanation, not retry loops.
- [ ] Show pending, failed, cancelled and completed handoff separately. Returning a VLC intent is not evidence that VLC played.
- [ ] Preserve keyboard/small-screen readability and host-specific return instructions. Keep provider/stream URLs redacted in public evidence.

## R06.3 — Physical qualification and product scope

- [ ] Build exact Android/iOS artifacts, record source SHA/artifact hash/runtime versions, and run existing host proof modes on devices according to the lab doc.
- [ ] Capture terminal input/rendering, live HTTPS, state persistence after relaunch, cancellation and actual player opening/decoding for owned/public test media.
- [ ] Android: document Termux/runtime version, storage grant, background/foreground behavior, process termination and resume result. iOS: document a-Shell/iOS/VLC version, URL handoff/return, file access and relaunch state.
- [ ] Repeat failure/retry sequences with permissions revoked or network disabled. Do not treat cross-compilation or emulator-only evidence as physical qualification.
- [ ] If local download/offline playback is absent, keep it explicitly outside mobile release claims. Design a future artifact/persistence port only after a real host supports and demonstrates it; do not port desktop services speculatively.

## Verification and closure

```sh
bun run --cwd apps/mobile test:unit
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile build
bun run --cwd apps/mobile test:integration
bun run --cwd apps/mobile test
```

Collect actual device observations using the lab procedure. The existing host
proof command validates the evidence matrix; it does not run on a device or
provide a --help mode. After producing the two redacted evidence files:

```sh
bun run test:live:mobile-host-proof -- --metadata apps/mobile/dist/mobile-build-meta.json --evidence /tmp/kunai-mobile-android.json --evidence /tmp/kunai-mobile-ios.json
```

The /tmp paths above must contain the genuine physical observations and match
the generated artifact hashes; they are output locations, not fabricated
fixtures. Update runtime/lab docs and mobile roadmap status. Run runbook gates.
Return deterministic state proof, artifact validation and physical proof as
separate evidence levels.
