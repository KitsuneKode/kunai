# R08 — Trustworthy daily interactions and useful failure communication

Status: WAITING FOR R02/R03/R04 OUTCOMES; no runtime implementation is claimed.
Baseline: `e5fd018af3d673d9dc10e866dabbf4428486ddb1`, 2026-10-01. Refresh before execution.
Execution policy, isolation, integration ownership and evidence: [runbook](./2026-10-01-execution-runbook.md).
Use the executing-plans workflow for implementation; delegate only when the assignment explicitly authorizes it.

**Global constraints:** Preserve unrelated changes. Use isolated HOME/USERPROFILE/XDG/APPDATA/LOCALAPPDATA roots, never KUNAI_CONFIG_DIR. No real-profile writes. Episode presentation is 1-based. Keep enforced package/layer directions. Analytics requires explicit consent; relay remains metadata-only with no bundled shared endpoint. Run fresh checks; record skips and native/external limits. No commit/publication/deployment is authorized by this plan.

**Goal:** Make keyboard focus, destructive intent and mutation outcomes predictable while preserving Kunai's established terminal design.
**Architecture:** Domain supplies pure focus/action policy; shell owns explicit interaction state; workflows return typed outcomes from R02/R03/R04 and render pending/success/failure.
**Tech stack:** Ink, TypeScript, existing input/render harness and real PTY driver.
**Spec:** Audit A16; [022 owner](./022-shell-interaction-coherence.md), [UX architecture](../.docs/ux-architecture.md), [keybindings](../.docs/keybindings.md).
**Dependencies:** R02 recovery, R03 deletion, R04 exact-source outcomes. No speculative visual redesign.

## Review focus

1. Filtering titles containing x/X/p/P never triggers destructive/protect hotkeys.
2. Broad destructive confirmations default to preservation across every entrypoint.
3. Failed save/export/delete remains visible and retryable; success requires committed work.
4. Esc/back/cancel semantics stay coherent across nested overlays and draft edits.
5. Narrow/no-image terminals communicate state/action without layout jumps or hidden controls.

## R08.1 — Finish current 022 residue

Allowed edits: `apps/cli/src/app-shell/library-shell.tsx`, `root-overlay-shell.tsx`, `settings/SettingsShell.tsx`, `ink-shell.tsx`, `workflows/shell-workflows.ts` in that directory; existing input-safety/domain policy and matching tests. Existing help-scope work is already landed; do not repeat it from stale line numbers.

- [ ] In `apps/cli/test/unit/app-shell/library-input-ownership.useinput.test.tsx` type “Spy x Family” and “Pluto” while filtering. Assert full query and zero delete/protect calls. Repeat paste, uppercase, backspace, Enter focus transfer and Esc.
- [ ] Model filter/list ownership explicitly. The active text editor consumes text; shortcuts run only under list focus. Do not reserve letters within normal text input.
- [ ] Exercise queue clear via overlay key, palette and workflow; destructive history clear and running download cancellation need deliberate intent. Default modal selection is Keep/Cancel. Use existing queue restoration for reversible removal; avoid a confirmation for every harmless reversible action.
- [ ] Implement a shared pure confirmation/arming policy only where semantics match. If using timed arming, inject clocks; do not require real sleeps in tests.
- [ ] Add rejected save/export ports to SettingsShell/stats workflow tests. Show pending until awaited persistence completes; on failure retain draft/surface with Retry/Cancel. Never show “Saved” or “Exported” before the operation succeeds.
- [ ] Test opposite/reverse states: disable after enable, dequeue after queue, unprotect after protect, cancel armed action, retry after failure and readback after relaunch.
- [ ] Walk 022.5's Esc/back table against current overlays and update it. Avoid implicit draft discard when persistence failed.

## R08.2 — Download/offline communication

Allowed edits: `apps/cli/src/app-shell/download-manager-shell.tsx`,
`apps/cli/src/app-shell/download-manager-view.ts`,
`apps/cli/src/app-shell/library-shell.tsx`,
`apps/cli/src/services/offline/offline-library-action-router.ts` and current
shell workflow callers/tests. Runtime policy stays with R03/R04; only existing
files or coordinator-approved new pure view models.

- [ ] Consume DownloadDeleteResult. deleted closes/refreshes with truthful success; retained keeps the item and exposes cleanup retry with the typed reason. A04 remains open until this integration passes.
- [ ] Render queued, running, intentionally paused, retry-deferred, space/path blocked, cleanup pending and complete/playable distinctly. Use codes rather than searching error text for “space”.
- [ ] Show selected profile/local subtitle availability, playable count, partial/staging bytes and storage headroom when known. Unknown-size HLS has an estimate/unknown ETA, never fabricated precision.
- [ ] Local launch failures offer integrity/repair/reselect, preserving exact selected job intent. Explain “video playable; subtitle repair pending” when only optional metadata is missing.
- [ ] “Quit and keep downloads queued” must say they resume next launch; current process exit does not continue a detached download. Disclose unsupported safe-publication storage before a long transfer through R03's capability outcome.
- [ ] Recoverable provider failure shows phase, bounded retry and an available action. Cancellation stops retries; automatic fallback never conceals a user's pinned provider/profile.

## R08.3 — Real user-path verification

Use the repo's [verify-kunai skill](../.agents/skills/verify-kunai/SKILL.md). Read it before running its drivers. Confirm rendered frames and SQLite/config deltas in the same run.

- [ ] Capture browse→play→post-play, palette invocation, queue clear/cancel/restore, settings reject/retry/relaunch, download deletion failure and offline exact-B launch.
- [ ] At widths 60/80/120 and rows 20/30, inspect help/footer/focus and no-image fallback; run actual advertised keys. Multiplexer and bracketed paste need native PTY checks.
- [ ] Start with deterministic provider/fake-player fixtures; qualify real playback separately. Seeded analytics remains declined; ensure no installId appears.
- [ ] Evidence citations must refer to captured frame/table text and be checked using --verify-citation. Do not infer completion solely from a unit test or internal callback.

## Verification and closure

```sh
bun run --cwd apps/cli test:file -- test/unit/app-shell/library-input-ownership.useinput.test.tsx test/unit/app-shell/queue-shell.test.tsx test/unit/app-shell/history-delete.test.tsx test/unit/app-shell/download-manager-shell.test.tsx test/unit/app-shell/settings/navigation.test.ts test/unit/architecture/contract-conformance.test.ts
bun run --cwd apps/cli typecheck
bun run --cwd apps/cli agent:drive -- --mpv fake --show frame,history,journal --evidence /tmp/kunai-r08-play --keys smoke "<enter>" "<wait:Smoke>" "<enter>" "<wait:Post-play>"
```

The final driver command verifies only the basic play path; design remaining key scripts from current advertised frames. Add focused save/export regressions to current owner tests, run runbook gates and update UX/key docs plus 022 residue. Return actual failure/confirmation/focus frames with committed backend state.
