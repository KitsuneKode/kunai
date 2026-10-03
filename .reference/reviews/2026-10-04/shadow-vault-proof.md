# Shadow credential-vault qualification

Captured 2026-10-04 (Asia/Calcutta). Redirecting HOME/XDG/APPDATA isolates
Kunai's files, but native credential vaults remain account-wide. An earlier
shadow-profile run invoked `secret-tool lookup`; those runs cannot establish
native-vault isolation.

The test helper now sets the existing `KUNAI_CREDENTIAL_BACKEND=file` override.
`createCredentialVault()` reads it before probing native backends. Production
backend selection is unchanged. Tests that exercise native backends inject
their own ports.

## Regression witnesses

Three simulated-platform tests (Linux secret service, macOS Keychain, Windows
credentials) failed before the helper change: each selected the native backend.
They now select the file backend, perform set/get/delete in the shadow config
directory, and assert zero native-tool lookups or spawns. Combined with the
existing vault tests: **26 pass, 0 fail**. Full forced suite: **8,100 pass,
60 skip, 0 fail**, 26 fresh tasks with no cache replays. Agent suite:
**9 pass, 1 opt-in real-mpv skip, 0 fail**.

## Actual terminal witness

Using the updated helper at `cfdc760702abb91033402d978c222b367c293fca` and the
offline CLI at `20fa74725726ec0d4649b7dc280efa4e3a183a32`, a fresh shadow
profile played two owned eight-second MP4s through real mpv under tmux. Null
audio/video outputs qualify the control and persistence path, not visible
video or audible sound.

Library → E1 → Post-play → Tracks → Episodes → E2 → series complete.
Captured frames mechanically match `Downloaded file`, `Tracks: player
controls`, both offline episode rows, and `SERIES COMPLETE`. Read-only SQLite
shows both episodes at position=duration=8, completed=1, with the original
`retired-provider` provenance. Config retains disabled analytics and an empty
install ID; provider caches and sync outbox remain empty.

The app process and its descendants were traced for `execve`. No `secret-tool`,
macOS `security`, PowerShell, or `pwsh` command was invoked. This corroborates
the Linux process path; simulated native-port tests cover backend selection
for the other platforms. The task-owned tmux session was stopped and its
profile retained. No data was copied back.

Local artifacts live under `/tmp/kunai-full-review-20261003/`:
`offline-file-vault-{tracks,picker,e2}/`, `offline-file-vault-history.json`,
and `offline-file-vault-execve.log`. These are local evidence, not hosted
artifacts. Physical phones, live providers, and store readiness remain
separate qualification gates.
