# PR #146 hardening repair report

## Revisions

- Original PR branch and repair base: `0bb210f8e5e48897b0a3da06a7ed28c336f41d3b`
- Local implementation commit: `77275ece51139de7eee24643c8f35dcfc309c952`
- Current post-#146 `origin/main`: `58c0b558a61484138800643c387ba17343aa69f8`
- The implementation patch applies cleanly to current `origin/main`. Verified with a temporary index loaded from `origin/main` and `git apply --cached --check` over the exact `0bb210f8..77275ece` binary diff.

## Changes

- Removed every bare/shared temp-directory candidate and the hard-coded `/tmp` socket fallback.
- Added an injected Unix-directory operations seam. Production creates candidates with mode `0700`, then checks `lstat` and `stat` facts before selecting one:
  - final path is a real directory and not a symlink;
  - `lstat` and `stat` identify the same device/inode;
  - permission bits are exactly owner `rwx` with no group/other access;
  - ownership matches the current uid when uid facts are available.
- Resolution prefers `$XDG_RUNTIME_DIR/kunai`, then `$TMPDIR/kunai-ipc`, and throws a bounded actionable error before spawn if neither is safe and bindable.
- Windows named-pipe spelling and behavior remain unchanged, and its path bypasses every filesystem operation.
- Added an opaque injected close-timer seam for mpv IPC. Clean close cancels the 200 ms fallback; the fallback is single-shot if close never arrives.
- Extracted `createDismissTimerRegistry` from the private Ink root. Fired alert handles remove themselves, and disposal clears every still-active overlapping 6 s/10 s handle.
- The reviewed external URL scheme/option guard was not changed.

## Strict TDD evidence

RED was observed before each production slice:

1. Unix fail-closed policy: 5 failures showed bare-temp candidates and `/tmp` fallback were still returned.
2. Directory verification seam: 4 failures showed the injected operations/facts were ignored, including symlink, wrong-owner, and unsafe-mode cases.
3. Clean mpv close: 1 failure showed the injected fallback timer was not scheduled/cleared.
4. Missing close event: 1 failure showed the fallback callback could terminate twice.
5. Streak dismissal registry: the new behavioral test failed because the extracted registry did not yet exist.

GREEN:

- Focused repair suite: 24 passed, 0 failed, 49 assertions.
- Earlier combined focused run including the existing streak milestone tests: 26 passed, 0 failed.

## Verification gates

- `bun run --cwd apps/cli test:unit`: 4,637 passed, 0 failed across 675 files.
- `bun run --cwd apps/cli test:integration -- test/integration/mpv-ipc-endpoint-native.test.ts`: the command exercised the complete CLI integration directory; 145 passed, 24 skipped, 0 failed. Both real-mpv endpoint tests passed.
- `bun run typecheck`: 14/14 tasks succeeded.
- `bun run lint`: 12/12 tasks succeeded. CLI reported 0 warnings/errors; one pre-existing `packages/relay/test/handler.test.ts` no-shadow warning remains outside this repair.
- `bun run fmt`: 12/12 tasks succeeded.
- `bun run build`: 10/10 tasks succeeded, including the development bundle and Linux host binary.
- `git diff --check`: passed before the implementation commit.

## Self-review

- Security mutations covered: reintroducing bare temp, trusting a symlink, accepting a different uid, permitting group/world bits, skipping creation failure, returning overlong paths, or touching filesystem operations on Windows all fail tests.
- Lifecycle mutations covered: omitting clean-close cancellation, allowing repeat fallback termination, retaining fired dismissal handles, or clearing only one overlapping dismissal all fail tests.
- The directory seam is confined to endpoint preparation; no user configuration root is hard-coded and no provider/player layering boundary changed.
- The timer extraction is non-React and limited to streak dismissals; alert text, durations, refresh cadence, and shell rendering behavior are unchanged.

## Remote state and actions

- Initial pre-edit GitHub verification: branch `fix/local-surface-hardening` existed at the required `0bb210f8e5e48897b0a3da06a7ed28c336f41d3b`.
- During the repair, PR #146 became `MERGED` with merge commit `b573f7000562d4ac9696d03a80746160dcf89d9d`; its head oid remained `0bb210f8`, and the remote head branch was deleted.
- No push, PR edit, merge, release, or publish action was performed.
- The local repair commit is ready to cherry-pick onto a new follow-up branch from current `origin/main`.
