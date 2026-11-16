# Physical phone qualification

Physical Android/iOS execution belongs to the user. Prepare a candidate manifest
and this checklist, then keep hardware outcomes explicitly unverified until
returned. Read [the install guide](../../../../docs/users/install-and-update.mdx)
for full Android CLI transfer commands and
[the mobile lab](../../../../.docs/mobile-device-lab.md) for the separate host proof.

## Choose the correct artifact

| Route              | Entrypoint / artifact                                                           | Scope                                                                   |
| ------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Full Android CLI   | `apps/cli/src/main.ts`; `apps/cli/dist/bin/kunai-android-arm64` (or x64)        | Search, providers, external player, downloads and same-device companion |
| Android host proof | `apps/mobile/src/entry.ts`; `apps/mobile/dist/android/kunai-mobile-android.mjs` | Node terminal/probe/state/VLC handoff only                              |
| iOS preview        | `apps/mobile/dist/ios/` artifact set                                            | a-Shell mini terminal/probe/state/VLC handoff only                      |

Record exact commit, dirty diff, architecture and SHA-256 before transfer.
The CLI uses `apps/cli/dist/bin/SHA256SUMS`; the host proof uses
`apps/mobile/dist/mobile-build-meta.json`. Neither metadata file authorizes the
other artifact. Unpublished candidates are built from trusted source, not
assumed to exist on public release URLs. Transfer through shared storage, then
copy executables into private Termux storage and verify hashes before execution.

## Full Android CLI matrix

Prepare official Termux, `termux-am`, VLC and/or mpv-android. Record OS,
architecture, Termux/player versions and artifact digest. For automated profile
seeding use `storageRootEnv` with `DO_NOT_TRACK=1` and file credentials; for user
runs explain whether the candidate shares their existing CLI profile.

1. Help/version return cleanly. Search each supported mode and open a real title.
2. `--player vlc` and `--player mpv` dispatch to the selected application;
   `--player auto` opens the chooser. Missing players fail with an explanation.
3. Watch video for at least 45 seconds. Record visible imagery, audible audio,
   progress, buffering recovery and subtitle correctness separately from intent
   acceptance. Returning to Termux must leave the shell usable.
4. Test headered media and one complete offline download with a subtitle sidecar.
   They use token-scoped loopback URLs, so keep Kunai running while the player
   reads. Confirm seek/Range behavior. The chooser cannot accept external
   subtitles and must refuse that combination honestly.
5. Replace playback, cancel pending resolution and exit Kunai. Old media URLs
   stop working; a late old failure must not revoke the new session. Reopen and
   play again. Do not infer external-player stop from a detached handoff.
6. Test the companion in the phone's own browser using `kunai serve`'s printed
   URL. Other-device/LAN access is outside this loopback surface.
7. Record failure details without raw media URLs, tokens, credentials or device
   identifiers. Preserve test evidence; remove only the separately named
   candidate executable when finished. Never use `killall node` or wipe profiles.

The installed native release has its own verified rollback/uninstall commands;
a manually transferred candidate is not an installer-managed version.

## Host-proof matrix (Android and iOS)

Follow the mobile lab rather than the full CLI matrix. Android uses Node + VLC;
iOS uses a-Shell mini + VLC. The proof has no catalog, providers, offline
library, chooser/mpv option or loopback media gateway.

Check help/version exit, explicit cancellation before probe/handoff, HTTPS
validation, bounded probe, private-state recovery, concurrent-launch refusal,
accepted VLC handoff and visible playback separately. On iOS preserve the
experimental label. Report schema-2 redacted evidence using the mobile lab.
