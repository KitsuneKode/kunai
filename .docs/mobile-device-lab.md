---
status: current
lastReviewed: "2026-09-03"
---

# Mobile device lab

> Agent-facing (L3). This is the repeatable qualification and debugging
> runbook for [mobile-terminal-runtime.md](./mobile-terminal-runtime.md).

## What this lab can prove

Record `runtimeVersion` from `node --version` on Android. For iOS record
`iOS <version>` because JavaScriptCore ships with the OS; also record the a-Shell
version. Evidence without this field must be recollected.

Test two concurrent launches from the same installation. The second must fail
without altering the first session's arguments or state. Normal cancellation
must release `session.lock`. After a forced termination, first close every
Kunai session, then remove only the empty lock directory with `rmdir`: Android
uses the state directory's `session.lock`; iOS uses `.runtime/session.lock`.
Never remove a lock while another session is running. Rerun to recover state.

Use one physical ARM64 Android phone and one physical iPhone. They are the
minimum support-gating matrix. A desktop run, Android emulator, iOS Simulator,
successful build, application switch, or accepted intent is diagnostic evidence
but is not platform qualification.

Keep these observations separate:

1. Artifact built and its digest matched.
2. The terminal application started it.
3. Interactive input worked.
4. Bounded HTTPS succeeded.
5. State replacement and recovery worked.
6. The operating system accepted the VLC handoff.
7. A human saw the tester-owned media begin in VLC.

Never turn observation 6 into observation 7.

## Trusted host preparation

Run from the repository root in a trusted checkout:

```sh
bun install --frozen-lockfile
bun audit
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile lint
bun run --cwd apps/mobile build
bun run --cwd apps/mobile test:unit
bun run --cwd apps/mobile test:integration
```

Inspect targets and set digests without printing any device URL:

```sh
jq '{version, targets: [.targets[].id], artifactSets}' \
  apps/mobile/dist/mobile-build-meta.json
```

Run the Android artifact locally under the same runtime family:

```sh
node apps/mobile/dist/android/kunai-mobile-android.mjs --help
node apps/mobile/dist/android/kunai-mobile-android.mjs --version
```

This validates the emitted Node program, not Android intent behavior. The
integration suite also drives its real prompt and SIGINT path, verifies private
state, validates the evidence CLI, and runs the complete iOS fake-host workflow.

Record the Kunai version, commit, Bun build version, host Node version,
individual artifact hashes, and artifact-set hashes. Do not transfer outputs if
the build or either test suite fails.

## Android: install and transfer

Required:

- a physical ARM64 device;
- a current supported Termux installation from one official source;
- VLC for Android;
- the generated `apps/mobile/dist/android/kunai-mobile-android.mjs`, which is not built on a clean checkout;
- one credential-free tester-owned HTTPS probe below 64 KiB;
- one credential-free direct HTTPS media URL that VLC can play without custom
  headers or cookies.

Follow [Termux's installation guidance](https://github.com/termux/termux-app#installation).
Do not mix Termux or plugin packages signed by different sources. Android Studio
is not required. Google's standalone
[SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)
provide `adb`; Android 11 and later may optionally use
[wireless debugging](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi).
Use USB first.

On the device in Termux:

```sh
pkg update
pkg install nodejs
node --version
termux-setup-storage
```

No npm package installation, Bun, PRoot distribution, Python, compiler, Android
SDK, or NDK is required.

On the build host:

```sh
adb devices -l
adb -d push apps/mobile/dist/android/kunai-mobile-android.mjs \
  /sdcard/Download/kunai-mobile-android.mjs
```

Use `adb push` only for transfer. `adb shell` is not the Termux application
sandbox and must not replace the foreground Termux session.

Back in Termux, copy the program into private executable storage:

```sh
mobile_lab="$(mktemp -d "${TMPDIR:-$PREFIX/tmp}/kunai-mobile-lab.XXXXXX")"
mobile_home="$mobile_lab/home"
mobile_program="$mobile_lab/kunai-mobile-android.mjs"

mkdir -m 700 "$mobile_home"
cp "$HOME/storage/downloads/kunai-mobile-android.mjs" "$mobile_program"
chmod 700 "$mobile_program"
sha256sum "$mobile_program"
uname -m
command -v node
command -v termux-am || command -v am
```

Compare the file hash with the Android artifact entry in
`mobile-build-meta.json`. The schema-2 artifact-set digest is a separate
canonical digest copied from the trusted metadata after every member is
verified. Never execute from shared storage.

The explicit VLC route supports only `termux-am` or `am`. `termux-open` and
`termux-open-url` are chooser routes and are not fallbacks for this build. If
neither supported command resolves, record a handoff failure.

## Android: run and qualify

Define URLs only in the private foreground session. Do not paste them into
issues, evidence JSON, shell tracing, or screenshots:

```sh
tester_probe_url='https://tester-owned.example/status'
tester_media_url='https://tester-owned.example/video.m3u8'

HOME="$mobile_home" node "$mobile_program" --help
HOME="$mobile_home" node "$mobile_program" --version
HOME="$mobile_home" node "$mobile_program" --host-proof \
  --probe-url "$tester_probe_url" \
  --media-url "$tester_media_url"
```

Help and version must each return to the Termux prompt on their own. A command
that prints output and remains alive is a failed terminal-lifecycle check, not
a slow start.

Run these cases with the same checksummed artifact:

1. At the first prompt press Ctrl+C. Confirm no HTTPS request or VLC launch.
2. Run again and choose `0`; confirm normal cancellation.
3. Run again and choose `Run proof`; confirm the bounded probe succeeds, the OS
   accepts the explicit VLC request, and media visibly begins.
4. Repeat cancellation with a tester-owned media URL containing a literal quote
   and backslash. It must reach the prompt without syntax execution.
5. Pass plaintext HTTP, credentials, a fragment, CR, LF, or another scheme. It
   must exit before HTTP or VLC.

The artifact exits `0` for help, version, cancellation, and an accepted handoff;
`2` for invalid commands or URLs; and `1` for state, HTTP, or handoff failure.
An accepted handoff still requires visible-playback observation.

### Android missing-current-state recovery

This checks recovery from a valid `.previous` file when the current file is
absent. It does not simulate a failed final activation or claim to qualify that
separate rollback path.

After one run:

```sh
state="$mobile_home/.local/share/kunai-mobile/mobile-state.json"
cp "$state" "$mobile_lab/operator-backup.json"
mv "$state" "$state.previous"
cp "$state.previous" "$state.tmp"
```

Run the program and cancel, then verify:

```sh
test -f "$state"
test ! -e "$state.previous"
test ! -e "$state.tmp"
stat -c '%a %n' "$(dirname "$state")" "$state"
```

Expected modes are `700` for the Kunai state directory and `600` for the state
file. Separately replace current state with invalid JSON and confirm the next run
fails before HTTP or VLC. Restore only the operator backup afterward.

### Android debugging

First classify the failed stage. For player-routing failures:

```sh
command -v termux-am || command -v am
adb logcat -c
```

Reproduce once, then collect a bounded filtered dump on the host:

```sh
adb logcat -d -v threadtime \
  'ActivityTaskManager:I' 'ActivityManager:I' 'AndroidRuntime:E' '*:S'
```

Android documents [Logcat filtering](https://developer.android.com/tools/logcat#filteringOutput).
Activity logs can contain full intent URLs or device identifiers. Inspect them
locally and discard them; never attach them to evidence or an issue.

| Observation                         | Likely boundary                                       |
| ----------------------------------- | ----------------------------------------------------- |
| `Permission denied`                 | Running from shared storage or wrong mode             |
| Node cannot load the file           | Damaged transfer, unsupported Node, or wrong filename |
| Invalid command, exit 2             | Flag or URL rejected before network                   |
| Failure before prompt               | HOME, state, or runtime construction                  |
| Failure after selection, VLC absent | HTTPS, missing launcher, or rejected intent           |
| VLC opens, media does not begin     | URL, TLS, codec, network, or VLC; playback is false   |

If VLC opens without playback, open the same tester-owned direct URL manually
in VLC. Manual failure isolates media/network/player behavior; manual success
points back to the handoff route.

Clean up after recording redacted results:

```sh
unset tester_probe_url tester_media_url
rm -rf "$mobile_lab"
```

Confirm `mobile_lab` is the specific temporary path printed by `mktemp` before
removing it.

## iPhone: install and transfer

Required:

- a physical iPhone;
- current App Store a-Shell mini;
- VLC for iOS;
- all five generated `apps/mobile/dist/ios` files, which are not built on a clean checkout;
- the same kind of tester-owned probe and media URLs used on Android.

No Node, Bun, Python, iSH, Alpine environment, or on-device package installation
belongs to this route. Transfer with Files, AirDrop, cable, or a-Shell `Put File`.
Apple documents [device file transfer](https://support.apple.com/guide/iphone/transfer-files-between-devices-iph339bafff3/ios),
and [a-Shell documents its Shortcuts and sandbox](https://github.com/holzschu/a-shell#shortcuts).
Use the foreground app, not the lightweight Shortcut extension, for proof.

Create a fresh a-Shell-owned directory and retain all filenames:

```sh
mkdir kunai-mobile-lab
cd kunai-mobile-lab
chmod 700 kunai-mobile kunai-mobile-http \
  kunai-mobile-open-vlc kunai-mobile-read-line
help -l | grep jsc
help -l | grep curl
help -l | grep openurl
./kunai-mobile --help
./kunai-mobile --version
```

Both commands must return to the a-Shell prompt without an extra Ctrl+C.

Verify all five transferred members against trusted build metadata before
running them. a-Shell's command set varies; use `help -l` to discover a checksum
command. Do not invent or install an unreviewed tool merely to fill evidence. If
exact on-device hashes cannot be reproduced, the physical row does not satisfy
artifact binding.

## iPhone: run and qualify

```sh
tester_probe_url='https://tester-owned.example/status'
tester_media_url='https://tester-owned.example/video.m3u8'

./kunai-mobile --host-proof \
  --probe-url "$tester_probe_url" \
  --media-url "$tester_media_url"
```

Repeat the Android cancellation, success, quote/backslash, and invalid-URL
cases. After success, failure, and Ctrl+C, `.runtime` must contain no
`argv-count`, `argv-*`, curl request/response, terminal-answer, or player-URL
transport file. An app switch or `openurl` return code alone is not playback.

### iPhone state recovery

After one run:

```sh
state='.runtime/mobile-state.json'
cp "$state" operator-backup.json
mv "$state" .runtime/mobile-state.previous
cp .runtime/mobile-state.previous .runtime/mobile-state.json.tmp
```

Run and cancel. Current state must be restored; `.previous` and `.tmp` must be
gone. Corrupt current separately and confirm fail-closed behavior, then restore
the operator backup.

### iPhone debugging

Use `help -l` first to confirm `jsc`, `curl`, and `openurl`. Check exact helper
filenames and the foreground exit status. On a Mac, reproduce with the phone
connected while viewing messages in
[Console](https://support.apple.com/guide/console/view-log-messages-cnsl1012/mac).
An App Store build cannot be attached like a locally signed development build;
connected-device logs are the useful boundary.

If VLC opens without playback, apply the same manual direct-URL isolation used
on Android. Keep raw logs local because they can include URLs and identifiers.

After recording redacted observations:

```sh
unset tester_probe_url tester_media_url
cd ..
rm -rf kunai-mobile-lab
```

Verify the directory name before removal.

## Evidence and aggregate gate

Create one URL-free schema-2 JSON file per physical device. Android example:

```json
{
  "schemaVersion": 2,
  "kunaiVersion": "0.3.0",
  "platform": "android",
  "osVersion": "15",
  "terminal": "termux",
  "terminalVersion": "0.119.0-beta.3",
  "runtimeVersion": "v22.18.0",
  "architecture": "arm64",
  "player": "vlc",
  "playerVersion": "3.7.0",
  "deviceClass": "physical",
  "artifactTarget": "android-termux-node",
  "artifactSetSha256": "<64 lowercase hexadecimal characters>",
  "terminalInput": "passed",
  "http": "passed",
  "stateRecovery": "passed",
  "cancellation": "passed",
  "handoffAccepted": true,
  "playbackBegan": true,
  "recordedAt": "2026-09-03T00:00:00.000Z"
}
```

For iOS use `platform: "ios"`, `terminal: "a-shell-mini"`, and
`artifactTarget: "ios-ashell"`, plus the iOS artifact-set digest. Keep
architecture `arm64` and device class `physical`.

Validate the pair from the same checkout and metadata used for transfer:

```sh
bun run test:live:mobile-host-proof -- \
  --metadata apps/mobile/dist/mobile-build-meta.json \
  --evidence /path/to/android.json \
  --evidence /path/to/ios.json
```

The command rejects unknown or sensitive fields, URLs, wrong hosts, emulators,
wrong versions, wrong targets or digests, duplicate or missing rows, and every
failed observation. Evidence is a reviewed human attestation; the validator
does not manufacture playback proof.

Keep the review ledger limited to artifact hashes, OS/runtime/player versions,
cold help time, time to prompt, bounded-probe time, handoff result, visible
playback, return responsiveness, and date. Do not retain URLs, device names,
serials, models, free-form notes, or raw logs.

## Emulator and simulator use

An Android emulator can diagnose Node startup, x64 behavior, Android API-level
differences, HTTPS, and intent routing. Google still recommends
[real-device testing before release](https://developer.android.com/studio/run/device).
Do not install Android Studio unless its emulator or GUI Logcat is useful; the
physical path needs only Platform-Tools.

a-Shell can run in Simulator, but the proof depends on the current App Store
host and VLC inter-application handoff. Simulator is useful only to isolate an
iOS-version or locally built host issue. It cannot fill the physical iPhone row.

## Rerun policy

Repeat deterministic builds and both physical rows after changes to mobile
application/host adapters; URL, HTTP, state, terminal, player, build, or evidence
contracts; Bun build version/options; or accepted Termux Node, a-Shell mini,
VLC, Android, or iOS versions.

Until both reviewed physical rows pass, keep Android and iOS marked preview and
not supported.
