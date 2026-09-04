---
status: current
lastReviewed: "2026-09-02"
---

# Mobile terminal runtime

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Kunai's mobile preview is a separate, private application under
[`apps/mobile`](../apps/mobile/). It shares one small TypeScript application
core, then builds platform-specific host adapters:

```text
apps/mobile/src/entry.ts
        |
        +-- Android: Bun/Bionic executable -> Termux -> Android VLC intent
        |
        +-- iOS: browser IIFE + fixed POSIX helpers -> a-Shell mini -> VLC URL scheme
```

This is not a native app, a PWA, a remote resolver, or the desktop CLI running
under emulation. Provider URLs stay direct and local. No analytics, install ID,
shared relay URL, media proxy, playback progress, or completion signal exists in
this application.

## Capability truth

| Surface                                                        | Deterministic contract                                               | Physical qualification                                                         | Support status    |
| -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------- |
| Shared host proof                                              | Terminal choice, bounded HTTP, atomic state, detached VLC handoff    | Not sufficient by itself                                                       | Preview only      |
| Android ARM64                                                  | Bionic ELF cross-build and fake-host tests                           | Physical Termux + VLC row required                                             | Not supported yet |
| Android x64                                                    | Bionic ELF cross-build and fake-host tests                           | Emulator startup/intent is informative; a physical row is required for support | Not supported yet |
| iOS ARM64                                                      | JavaScriptCore-safe IIFE, five-file a-Shell package, fake-host tests | Physical iPhone + current a-Shell mini + VLC row required                      | Not supported yet |
| Search, catalog, episode/source selection, provider resolution | Not present in the host-proof application                            | Not applicable yet                                                             | Not implemented   |
| Install, update, rollback, uninstall, publishing               | Not present                                                          | Not applicable yet                                                             | Not implemented   |

A successful handoff means only that Android or a-Shell accepted the request to
open VLC. The terminal process cannot observe playback. A human tester must
separately set `playbackBegan: true` only after seeing the tester-owned media
start in VLC.

## Runtime and build boundaries

[`apps/mobile/src/application`](../apps/mobile/src/application/) contains the
portable host-proof policy. It knows only the HTTP, state, terminal, and player
ports. [`apps/mobile/src/runtime/android`](../apps/mobile/src/runtime/android/)
owns Bun, Termux, and Android intent mechanics.
[`apps/mobile/src/runtime/ashell`](../apps/mobile/src/runtime/ashell/) owns the
documented a-Shell JavaScriptCore host and fixed helper bridge. Neither app may
import the other; both may depend on shared packages.

The terminal port owns a host input handle, so it declares `close()` and
[`apps/mobile/src/entry.ts`](../apps/mobile/src/entry.ts) calls it on every path
out — success, cancellation, a rejected argument list, and composition failure
alike. Android opens stdin on the first read rather than at construction, which
keeps `--help` and `--version` off the handle entirely. This is not decorative:
a reader left open holds the Bun event loop open, so the binary prints its
output and then never exits under any terminal that keeps stdin open, which is
every real one. `test/integration/android-entry-lifecycle.test.ts` runs the
bundled entrypoint with stdin held open and fails if a path does not terminate.

The choice formatter always appends its own `0. Cancel`, so callers list only
the affirmative options. Answers are trimmed before interpretation, because
a-Shell's `read -r` preserves whatever padding a soft keyboard produced. On
a-Shell the only output primitive is `console.log`, which supplies its own
newline; nothing can print a partial line, so the prompt is written without a
trailing space instead of pretending input will land beside it.

The build consumes only the one mobile entrypoint. It resolves the virtual
runtime import to one composition, rejects native/desktop modules from the iOS
graph, scans the emitted IIFE, executes it against a fake JavaScriptCore host,
and records SHA-256 plus measured raw/gzip bytes for every output.

On iOS, the foreground launcher never gives raw user arguments to `jsc`.
a-Shell constructs JavaScript source from command arguments, so treating that
boundary as an ordinary process argv would make otherwise valid URL characters
active source before Kunai could validate them. The launcher instead applies
`umask 077`, writes at most 32 arguments to separately numbered files under the
app-owned `.runtime` directory, publishes the count last, and invokes `jsc`
with only `./kunai-mobile-ios.js`. The composition reads the files exactly,
removes the complete transport, fails if deletion is not observable, and only
then gives the values to the portable argument and URL validators. Exit and
signal traps remove any files left by an interrupted launch. The iOS graph and
emitted bundle are both rejected if they use any `process` API.

## Trusted-build verification

Run this sequence from a clean trusted checkout before transferring anything
to a device:

```sh
bun install --frozen-lockfile
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile lint
bun run --cwd apps/mobile build
bun run --cwd apps/mobile test:unit
bun run --cwd apps/mobile test:integration
```

The ignored output directory contains two Android executables, the iOS IIFE,
four executable helpers, and `mobile-build-meta.json`. A cross-build proves the
artifact shape, not that Android's loader or current App Store applications
accept it.

Review the generated `mobile-build-meta.json` in the ignored mobile output
directory after every build. The integration suite recomputes each hash, raw
size, gzip size, executable mode, Android ELF machine, iOS dependency scan,
fixed-launcher contract, and fake-host workflow. Do not transfer an artifact if
that suite fails or if the transferred file's SHA-256 differs from the metadata.

## Efficient device lab and debugging

Start with one physical ARM64 Android phone and one physical iPhone. They are
the smallest useful lab because those are the two support-gating rows. Run the
trusted-build suite once, then reuse the exact checksummed artifacts on both
devices; add emulators or extra OS versions only after a physical failure needs
isolation. This keeps build failures, host failures, and media failures separate.

### Minimum tools

| Host path | Required                                                                                                  | Optional diagnostic layer                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Android   | Physical device, current supported Termux build, VLC for Android, USB cable or another file-transfer path | Standalone Android SDK Platform-Tools for `adb push` and `adb logcat`; Android Studio only if its emulator or GUI Logcat is useful |
| iPhone    | Physical iPhone, current App Store a-Shell mini, VLC for iOS, Files/AirDrop/Shortcuts transfer path       | A Mac and Console for connected-device system logs; Xcode only if debugging or rebuilding a host application itself                |

Android Studio is not required. Google publishes
[SDK Platform-Tools separately](https://developer.android.com/tools/releases/platform-tools)
specifically for command-line `adb` use without Studio. Enable Developer options
and USB debugging, approve the workstation key, then verify the target with
`adb devices -l`; Android also supports
[wireless debugging on Android 11 and later](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)
when the phone and workstation share a trusted network. Use USB first because it
has fewer discovery and firewall variables.

Install Termux using its current
[official installation guidance](https://github.com/termux/termux-app#installation),
and do not mix Termux or plugin APKs signed by different distribution sources.
Neither a Termux plugin nor an Android SDK/NDK is required for the proof. With
Platform-Tools, transfer the artifact only through shared storage:

```sh
adb -d push apps/mobile/dist/kunai-mobile-android-arm64 \
  /sdcard/Download/kunai-mobile-android-arm64
```

The Android `adb` contract permits
[pushing arbitrary files](https://developer.android.com/tools/adb#copyfiles).
Inside Termux, run `termux-setup-storage` once if necessary, copy the file from
`~/storage/downloads` into a private Termux directory, verify its SHA-256 there,
and execute only the private copy. Termux documents that
[shared storage does not provide normal executable filesystem semantics](https://github.com/termux/termux-packages/wiki/Termux-file-system-layout#termux-rootfs-directory).
`adb shell` is the Android shell, not the Termux application sandbox; use it for
device inspection, not as a replacement for the foreground Termux session.
VLC's public manifest currently declares generic `ACTION_VIEW` handling for
HTTPS media with `video/*`; keep testing that
[documented intent surface](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/AndroidManifest.xml)
instead of a private VLC activity.

For iPhone, transfer the five files with Files, AirDrop, or an a-Shell Shortcut.
Apple documents the available
[wireless, cloud, cable, and server transfer paths](https://support.apple.com/guide/iphone/transfer-files-between-devices-iph339bafff3/ios),
and a-Shell exposes
[`Put File` and `Get File` Shortcut actions](https://github.com/holzschu/a-shell#shortcuts).
Keep the interactive proof in the foreground application, not a Shortcut
extension. Copy into a fresh a-Shell-owned directory, preserve every filename,
mark the four helpers executable, and compare the transferred contents with the
build metadata before running them. On a Linux workstation that already exposes
an SSH server on the trusted local network, the
[a-Shell mini App Store listing](https://apps.apple.com/us/app/a-shell-mini/id1543537943)
documents `scp`, so the phone may instead pull `dist/ios` directly; do not add a
new network service solely for one transfer. Record the host key decision and
still verify the received files.

### Emulator and simulator boundary

An Android x64 emulator is optional and useful only for a quick x64 loader,
terminal, HTTPS, and intent-routing smoke. The Android Emulator can exercise
multiple API levels and many device capabilities, but Google still says to
[test on real hardware before release](https://developer.android.com/studio/run/device).
Do not spend time installing the emulator unless an x64 or Android-version
regression needs isolation. An emulator app switch, VLC launch, or observed
emulated playback does not qualify the required physical Android ARM64 row.

a-Shell mini can run in Simulator according to the
[a-Shell project](https://github.com/holzschu/a-shell), but the Kunai proof also
depends on the installed VLC application and real inter-application handoff.
Apple states that Simulator does not replicate all physical-device features or
performance and requires physical-device verification for exact behavior; see
[simulated versus physical devices](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).
Therefore Xcode Simulator is not part of the efficient qualification path. It
becomes useful only if maintaining a locally built a-Shell/VLC host or isolating
an iOS-version issue, neither of which qualifies the App Store host combination.

### Failure-isolation ladder

1. Reproduce with the same artifact and isolated state, recording the exact
   stage: startup, prompt, HTTPS probe, handoff acceptance, app switch, or visible
   playback. Never collapse those observations into one result.
2. If Android cannot launch the player, check
   `command -v termux-am am termux-open termux-open-url`, clear the system log
   with `adb logcat -c`, reproduce once, then inspect a bounded dump such as
   `adb logcat -d -v threadtime 'ActivityTaskManager:I' 'ActivityManager:I' 'AndroidRuntime:E' '*:S'`.
   Command-line Logcat supports
   [tag and priority filters](https://developer.android.com/tools/logcat#filteringOutput).
3. If iOS does not switch applications, first use a-Shell's `help -l` command
   list to confirm `jsc`, `curl`, and `openurl`, then inspect the fixed helper
   filenames and exit status.
   On a Mac, connect the iPhone by cable and reproduce while viewing it in
   [Console](https://support.apple.com/guide/console/view-log-messages-cnsl1012/mac).
   An App Store distribution build cannot be attached to the Xcode source
   debugger like a locally signed development build; connected-device logs are
   the useful boundary here.
4. If VLC opens but playback does not begin, open the same tester-owned direct
   media URL manually in VLC. Manual failure points to URL, TLS, codec, network,
   or VLC behavior; manual success points back to the handoff route. In either
   case, `handoffAccepted` may be true while `playbackBegan` remains false.
5. Capture raw logs only for local diagnosis. Android activity logs and Apple
   device logs can contain the full intent URL or device identifiers. Do not
   attach them or paste them into an issue. Record only the fixed redacted
   evidence fields below after visually checking playback, and restore Termux
   verbose logging to normal if it was temporarily enabled; Termux warns that
   [verbose logs may contain private data and add overhead](https://github.com/termux/termux-app#debugging).

For repeat runs, keep a host-side test ledger containing artifact hash, OS,
terminal/player versions, cold-start timing, prompt timing, handoff result, and
visible-playback result. Keep URLs and raw logs out of it. One failing stage plus
one local diagnostic is more useful than repeatedly running the full workflow.

## Physical Android ARM64 procedure

Prerequisites are a physical ARM64 Android device, a supported Termux build,
VLC for Android, the checksummed ARM64 artifact, one tester-owned HTTPS probe
that returns 2xx below 64 KiB, and one direct HTTPS media URL that VLC can play
without cookies or custom headers. Do not put either URL in evidence or logs.

1. Compare the transferred artifact's SHA-256 with `mobile-build-meta.json` on
   the build machine. Copy it from shared storage into Termux-owned storage;
   never execute it from shared storage. Mark the private copy executable.
   `uname -m` must agree with the selected artifact: `aarch64` uses
   `kunai-mobile-android-arm64`; `x86_64` uses
   `kunai-mobile-android-x64`.
2. Create a new temporary directory under Termux's private temporary storage.
   Set `HOME` to that directory only for each proof command. Do not use
   `KUNAI_CONFIG_DIR` and do not point the preview at an existing Kunai profile.
3. Run help and version from the absolute artifact path. Confirm the version
   matches the build metadata, and that each command **returns to the Termux
   prompt on its own**. Do not pipe or redirect stdin for this step: an
   interactive terminal keeps stdin open, which is exactly the condition a host
   that never releases its input handle fails under. A command that prints and
   then sits there is a failure, not a slow start; record `terminalInput` as
   `failed`.
4. Start the host proof in the foreground:

   ```sh
   HOME="$mobile_home" "$mobile_binary" --host-proof \
     --probe-url "$tester_probe_url" \
     --media-url "$tester_media_url"
   ```

5. At the choice prompt, press Ctrl+C once. Confirm the foreground command
   cancels without HTTP or VLC. Run it again, choose `Run proof`, confirm the
   bounded probe succeeds, Android accepts the VLC intent, and the video
   actually begins.
6. In the isolated `HOME`, preserve
   `.local/share/kunai-mobile/mobile-state.json` as an operator backup. Simulate
   interruption between backup and activation by moving the working file to
   `mobile-state.json.previous` and copying it to `mobile-state.json.tmp`. Rerun
   the host proof and cancel at the prompt. Confirm the previous file was
   restored as current and the staged file was removed. This proves interrupted
   replacement recovery. Separately replacing current with invalid JSON must
   fail closed before HTTP/VLC; restore the operator backup afterward.
7. Delete the temporary `HOME` after recording only the redacted observations.

For the security row, run a cancellation-only proof whose media URL contains a
literal single quote and backslash. It must reach the normal prompt without a
shell or JavaScript syntax error, and cancellation must leave no player launch.
Then pass a URL containing CR, LF, credentials, a fragment, plaintext HTTP, or another non-HTTPS
scheme; it must fail before HTTP or VLC. Use only tester-owned, credential-free
URLs because arguments can be visible to the same Android application UID
while the process is alive.

For the performance row, record cold `--help`, time-to-prompt, bounded-probe
completion, return-to-terminal responsiveness, and artifact sizes from the
metadata. The first reviewed physical run establishes the baseline; later
artifacts regress if they exceed the accepted baseline without an explained
feature cost. No made-up desktop threshold substitutes for device evidence.

Android x64 follows the same steps on an x64 Android device. An emulator may
prove loader startup and intent acceptance, but it does not qualify a physical
device row; record unobserved playback as false.

## Physical iPhone procedure

Prerequisites are a physical ARM64 iPhone, the current App Store a-Shell mini,
VLC for iOS, all five files from the iOS artifact directory, and the same kind
of tester-owned probe/media URLs described above. No Node, Bun, Python, iSH,
Alpine userland, or on-device package installation is part of this path.

1. Compare all five SHA-256 values with `mobile-build-meta.json` before transfer.
   Copy the IIFE and four helpers into a new a-Shell-owned directory. Keep their
   filenames unchanged and mark the four extensionless shell helpers executable.
2. Change into that directory and run `./kunai-mobile --help`. The launcher must
   remain in the foreground, return to the a-Shell prompt on its own, and create
   state only in its local `.runtime` directory. Each rendered block must be one
   line group with no blank line between the menu entries, and the menu must
   offer exactly one cancel entry.
3. Run the host proof:

   ```sh
   ./kunai-mobile --host-proof \
     --probe-url "$tester_probe_url" \
     --media-url "$tester_media_url"
   ```

4. Press Ctrl+C at the fixed read-line prompt and confirm cancellation. Rerun,
   choose `Run proof`, confirm the bundled `curl` probe succeeds, and confirm
   `openurl` transfers the direct URL to VLC.
5. Watch the tester-owned media begin in VLC. A return code or app switch alone
   is not playback evidence. If the current VLC x-callback route closes or does
   not start playback, record failure; do not silently substitute a different
   URL scheme and call the existing artifact qualified.
6. Preserve `.runtime/mobile-state.json` as an operator backup. Simulate an
   interrupted activation by moving the working file to
   `.runtime/mobile-state.previous` and copying it to
   `.runtime/mobile-state.json.tmp`. Rerun and cancel at the prompt; current
   must be restored and the staged file removed. Separately corrupt current and
   prove a fail-closed rerun, then restore the operator backup. Delete the proof
   directory after exporting only redacted observations.

For the security row, repeat the cancellation-only quote/backslash case from
Android. After success, failure, and Ctrl+C, `.runtime` must contain no
`argv-count` or `argv-*` file. A URL containing CR, LF, credentials, a fragment,
plaintext HTTP, or another non-HTTPS scheme must fail before `curl` or `openurl`. This specifically
qualifies the file-backed argv boundary; a fake JavaScriptCore test is not a
replacement.

For the performance row, record cold help, time-to-prompt, bounded-probe
completion, app-switch latency, terminal responsiveness after returning from
VLC, and the five artifact sizes. Use the first reviewed physical iPhone run as
the baseline. a-Shell and VLC versions belong in the review record because App
Store updates can change behavior independently of Kunai.

## Security and performance audit checklist

Security review is incomplete unless all of these remain true:

- raw user/provider data is never part of a `jsc.system()` command or the
  launcher's `jsc` arguments;
- only absolute credential-free HTTPS URLs without controls or fragments are
  accepted;
- HTTPS is bounded to 8 seconds, three HTTPS-only redirects, and 64 KiB;
- transient argv, curl, terminal-answer, and player-URL files use fixed private
  paths and are removed on success, cancellation, and failure;
- logs, state, build metadata, and device evidence contain no URLs, headers,
  cookies, tokens, or install identifiers;
- Android player execution uses fixed argument arrays and iOS helper execution
  uses a literal allowlist—neither evaluates a constructed command string.

Performance review is deliberately evidence-based:

- compare raw and gzip artifact sizes against the last accepted metadata;
- keep startup work to argument decoding, adapter construction, and state load;
- keep the host proof to one bounded HTTP request and one detached player
  handoff, with no polling or playback-monitor process;
- inspect cold-start, prompt, handoff, return, and terminal responsiveness on
  both physical platforms;
- treat emulator timings and desktop fake-host timings as diagnostics only.

### Android artifact-size decision

The 2026-09-01 host-proof build measured 89,585,312 bytes raw / 36,518,226
bytes gzip for ARM64 and 92,032,992 bytes raw / 37,642,211 bytes gzip for x64.
Those are observations, not permanent ceilings. Bun standalone executables
include a copy of the Bun runtime; the portable mobile application itself is a
small part of those files. Stripping a temporary x64 copy removed only 65,912
bytes (about 0.07 percent), so symbol stripping and more TypeScript minification
cannot make this architecture materially smaller. See Bun's
[standalone executable contract](https://bun.sh/docs/bundler/executables).

The current default therefore optimizes for one downloaded file and no runtime
installation: publish compressed Bun/Bionic artifacts. A later Android-lite
spike may add a QuickJS-ng Termux composition that uses the same portable
TypeScript application and fixed host seams. Termux currently packages
[QuickJS-ng](https://github.com/termux/termux-packages/blob/master/packages/quickjs-ng/build.sh),
but that route moves weight into a `pkg` dependency and is not accepted until a
physical device proves runtime compatibility, startup, HTTP limits, state
recovery, cancellation, and VLC handoff. Shipping a second unqualified runtime
here would trade a measured size problem for an unmeasured support problem.

## Redacted evidence

Device evidence is a flat schema with no free-form notes. It rejects unknown
fields, credentials, cookies, URL-shaped values, query strings, invalid hashes,
unsupported platform/terminal pairs, and future schema versions. Create one
file per device without probe/media URLs:

```json
{
  "schemaVersion": 1,
  "platform": "android",
  "osVersion": "15",
  "terminal": "termux",
  "architecture": "arm64",
  "player": "vlc",
  "artifactSha256": "<64 lowercase hexadecimal characters>",
  "terminalInput": "passed",
  "http": "passed",
  "stateRecovery": "passed",
  "cancellation": "passed",
  "handoffAccepted": true,
  "playbackBegan": true,
  "recordedAt": "2026-08-31T12:00:00.000Z"
}
```

Validate it from a trusted checkout. The validator reads only the explicitly
supplied file, prints one redacted matrix row, and exits non-zero if any required
observation failed or is false:

```sh
bun run test:live:mobile-host-proof -- --evidence /path/to/redacted-evidence.json
```

Evidence must be attached to review; it is not committed if repository policy
does not explicitly establish an evidence directory and retention rule. Until
the Android ARM64 and iPhone rows both pass and are reviewed, no documentation,
release metadata, or installer may describe either platform as supported.

## Remaining path to mobile parity

The next work is deliberately outside this host-proof slice:

1. add portable catalog/search and both anime and TMDB identity lanes;
2. qualify each provider and stream shape against mobile HTTP/player limits;
3. add title, episode, source, quality, and player selection;
4. repeat physical tests with real provider resolution rather than tester URLs;
5. design checksummed install/update/rollback/uninstall flows inside each
   terminal application's sandbox;
6. publish versioned preview artifacts, then revisit support only from reviewed
   evidence.

TV platforms remain deferred and are not implied by either mobile adapter.

## Appreciation and influences

Kunai's mobile terminal direction owes a lot to
[ani-cli](https://github.com/pystardust/ani-cli), which demonstrated that a
small terminal workflow can serve Android and iOS users by handing a direct
stream to an installed player. Kunai uses an independent TypeScript application
core and stricter build/evidence boundaries, but that practical example helped
shape the product direction.

This host proof is possible because of
[Termux](https://github.com/termux/termux-app),
[a-Shell](https://github.com/holzschu/a-shell),
[Bun](https://github.com/oven-sh/bun), and
[VLC](https://www.videolan.org/vlc/). Their projects are dependencies or host
environments, not endorsements of Kunai. Preserve their license notices when
future packaging starts, and re-check their current runtime and distribution
terms before publishing artifacts.
