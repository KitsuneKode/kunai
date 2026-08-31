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

```sh
bun run --cwd apps/mobile build
bun run --cwd apps/mobile test:integration
```

The ignored output directory contains two Android executables, the iOS IIFE,
four executable helpers, and `mobile-build-meta.json`. A cross-build proves the
artifact shape, not that Android's loader or current App Store applications
accept it.

## Physical Android ARM64 procedure

Prerequisites are a physical ARM64 Android device, a supported Termux build,
VLC for Android, the checksummed ARM64 artifact, one tester-owned HTTPS probe
that returns 2xx below 64 KiB, and one direct HTTPS media URL that VLC can play
without cookies or custom headers. Do not put either URL in evidence or logs.

1. Compare the transferred artifact's SHA-256 with `mobile-build-meta.json` on
   the build machine. Copy it from shared storage into Termux-owned storage;
   never execute it from shared storage. Mark the private copy executable.
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
