# Feature Coverage and Scenario Recipes

Choose the rows relevant to the candidate change. Do not run every opt-in tier by default.
Start through the feature map (`.docs/feature-map.md`), inspect the owning code/tests before driving.
Every recipe requires:

1. Exact input / trigger action
2. Observable proof (literal quoted frame line or committed SQLite/config value)
3. Reverse case (how the action is undone and verified)
4. Failure case (how boundary or error cases fail honestly)

## 1. Feature Coverage Matrix

| Journey                               | Observable proof                                                                                                                               | Reverse case                                                                           | Failure case                                                                                                                          |
| :------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| **Config migration**                  | Explicit user settings (`provider`, `footerHints`, `analytics`) preserved after schema update; new defaults populated without overwrite        | Edit setting back to default; restart; setting persists as default                     | Corrupted JSON fails closed before database reads; unreadable file backed up                                                          |
| **Provider registration**             | Provider present in `loadProductionProviderModules()`, initialized in `createProviderEngine()`, and listed in active ordered modules           | Disable provider via `config.disabledProviders`; verify exclusion from active resolves | Module exported in `packages/providers` but omitted from `bootstrap-providers.ts` fails registration check                            |
| **Audio intent: startup vs explicit** | Explicit audio choice persisted in session; default player stream observation does not overwrite explicit language                             | Reset title content / playback; audio resets to default auto behavior                  | Unsupported audio track index rejected gracefully; falls back to default stream                                                       |
| **Audio intent: reconnect & reuse**   | Same-URL reconnect retains selected audio track; subsequent episode in series reuses previous episode's explicit audio selection               | Switch episode audio manually; subsequent episode reuses newly selected preference     | Reconnect during network drop restores stream position and audio track without double-override                                        |
| **Audio intent: prefetch isolation**  | Background prefetch stream does not mutate currently playing stream's audio configuration                                                      | Clear prefetch cache; current playback audio unaffected                                | Failed prefetch stream does not interrupt or reset active player audio                                                                |
| **Downloads: relative paths**         | New enqueue output paths are absolute even when the configured download directory is relative; files remain within the isolated test directory | Delete download; database and disk reflect removal                                     | Gateway rejects a forged or changed artifact identity; explicit user-selected download directories retain their normal path semantics |
| **Downloads: revoked transfers**      | Revoking a local playback session cancels its in-flight response readers and closes file descriptors                                           | A new playback session creates a fresh token and can read the same verified file       | Stale token request returns HTTP 404 / 410; successor session remains readable                                                        |
| **Up Next queue**                     | Enqueued title stored in `playlist_queue`; frame displays item in Up Next                                                                      | `x` removes item from Up Next; `z` reverses removal                                    | Failed resolve marks item failed in queue; does not double-consume                                                                    |
| **Returning launch**                  | Session survives quit and relaunch; `--offline` flag parks on offline library without network                                                  | Quit and restart with normal flags; browse shell restored                              | Malformed flags exit 2 before session initialization; no orphaned processes                                                           |
| **Settings & privacy**                | Toggle committed to `config.json` after debounced write (`<wait-config:key=val>`); `installId` empty                                           | Toggle back; committed file agrees                                                     | Analytics opt-out strictly enforced; zero telemetry packets dispatched                                                                |
| **Android CLI**                       | Android Termux hands stream to VLC/mpv-android via explicit intent; loopback gateway serves headers/subtitles                                  | Cancel pending playback; no late intent dispatched and gateway token revoked           | Chooser route (`--player auto`) refused when external subtitles required                                                              |

---

## 2. Detailed Recipe Specifications

### Recipe: Audio Intent Persistence vs Default Startup

- **Happy Path**:
  1. Boot Kunai on seeded profile.
  2. Play Title (Smoke Series S1E1). Player emits default audio stream (e.g. Japanese).
  3. User explicitly selects English audio track in audio selector.
  4. Advance to S1E2.
  5. **Observable Proof**: S1E2 initializes with English audio track pre-selected.
- **Reverse Case**:
  1. User triggers content reset / reset preferences.
  2. **Observable Proof**: Playback reverts to auto/default audio track selection.
- **Failure Case**:
  1. Requested language unavailable in S1E3.
  2. **Observable Proof**: Player falls back cleanly to default stream and logs diagnostic without crashing or hanging playback.

### Recipe: Relative download paths and local playback revocation

1. In an isolated working directory configure a relative download directory;
   enqueue an item and assert its persisted output path is absolute and resolves
   to that chosen directory. Explicit absolute directories remain supported.
2. Verify a completed download and serve its authorized descriptor through the
   local gateway. A forged path or changed file must be refused.
3. Start reading a response, then stop that session. Its reader must terminate,
   file descriptors and active-body accounting must drain, and old URLs must fail.
4. Start a successor session and read it successfully. A stale stop/failure must
   not revoke it. This is playback revocation, not download cancellation.

### Recipe: Queue Persistence, Deletion, and Undo (L3)

```sh
bun run agent:session -- start --name q1
bun run agent:session -- do smoke "<enter>" --name q1
bun run agent:session -- wait-for "Smoke" --name q1
bun run agent:session -- do q --name q1
bun run agent:session -- inspect queue --name q1          # Verify item added
bun run agent:session -- do / --name q1
bun run agent:session -- wait-for "Command palette" --name q1
bun run agent:session -- do queue "<enter>" --name q1    # Enter Up Next
bun run agent:session -- do x --name q1                  # Remove item
bun run agent:session -- inspect queue --name q1          # Verify item removed
bun run agent:session -- do z --name q1                  # Undo removal
bun run agent:session -- inspect queue --name q1          # Verify item restored
bun run agent:session -- stop --name q1
```

### Recipe: Settings Persistence with Debounced Backend Verification (L2)

```sh
bun run agent:drive -- \
  --show config --verify-citation '"footerHints": "minimal"' \
  --keys "/" "<wait:command>" settings "<enter>" \
         "<wait:Usage analytics>" "<down>" "<enter>" \
         "<wait:Minimal>" "<down>" "<enter>" \
         "<wait-config:footerHints=minimal>"
```

- **Observable Proof**: `config.json` commits `"footerHints": "minimal"`.
- **Reverse Case**: Re-run with keys navigating back to `normal`; verify `"footerHints": "normal"`.
- **Privacy Gate**: Verify `installId` remains undefined and `analytics` remains declined.
