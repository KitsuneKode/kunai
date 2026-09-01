---
status: current
lastReviewed: "2026-09-01"
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
3. Run help and version from the absolute artifact path. Confirm the process is
   interactive and the version matches the build metadata.
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
   remain in the foreground and create state only in its local `.runtime`
   directory.
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
