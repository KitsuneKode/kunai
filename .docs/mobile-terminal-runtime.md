---
status: current
lastReviewed: "2026-09-03"
---

# Mobile terminal runtime

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

Kunai's mobile preview is a private application under
[`apps/mobile`](../apps/mobile/). It reuses a small TypeScript application core
behind platform ports; it does not import the desktop CLI.

```text
apps/mobile/src/entry.ts
        |
        +-- Android: Node ESM -> Termux Node -> fixed Android VLC intent
        |
        +-- iOS: JavaScriptCore IIFE + fixed helpers -> a-Shell mini -> VLC URL scheme
```

This is not a native app, PWA, remote resolver, or desktop CLI running under
emulation. Provider URLs remain direct and local. The preview has no analytics,
install ID, shared relay URL, media proxy, playback monitor, or completion
signal.

## Capability truth

| Surface                                                | Deterministic contract                                            | Physical qualification                            | Status            |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------- | ----------------- |
| Shared host proof                                      | Terminal choice, bounded HTTP, atomic state, detached VLC handoff | Not sufficient alone                              | Preview only      |
| Android                                                | One architecture-neutral Node ESM; real Node artifact smokes      | Physical ARM64 Termux + VLC row required          | Not supported yet |
| iOS                                                    | JavaScriptCore-safe IIFE, four fixed helpers, fake-host workflow  | Physical iPhone + a-Shell mini + VLC row required | Not supported yet |
| Search, catalog, provider and episode/source selection | Not implemented in this application                               | Not applicable                                    | Not implemented   |
| Install, update, rollback, uninstall and publishing    | No supported channel yet                                          | Not applicable                                    | Not implemented   |

`handoffAccepted` means only that the host accepted a request to open VLC. The
terminal cannot see whether decoding or playback began. Only a human watching
the tester-owned media start may record `playbackBegan: true`.

## Ownership and boundaries

[`apps/mobile/src/application`](../apps/mobile/src/application/) owns portable
argument validation, choice policy, HTTP/state/player contracts, and the host
proof. [`apps/mobile/src/runtime/android`](../apps/mobile/src/runtime/android/)
owns Node, Termux, and Android process mechanics.
[`apps/mobile/src/runtime/ashell`](../apps/mobile/src/runtime/ashell/) owns the
a-Shell JavaScriptCore bridge. Platform adapters may depend on the application;
the application may not depend on either adapter. Neither mobile app imports
the other or the desktop CLI.

The terminal port owns its host input lifecycle. The mobile entrypoint closes
that port on success, cancellation, invalid input, failure, and unexpected
exceptions. Android opens stdin only when a choice is requested, installs the
interruptible read before exposing the prompt, and releases the reader after
the application returns. This keeps help/version off stdin, prevents typed
cancellation from leaving Node alive, and prevents an immediate Ctrl+C from
racing the signal handler. The emitted-artifact integration suite exercises
both cancellation paths with stdin deliberately left open.

The shared package seam is intentionally small: `@kunai/core` owns the pure
Android intent plan because the desktop handoff preview and mobile app both
consume it. Node, a-Shell, filesystem, terminal, and evidence mechanics remain
inside `apps/mobile`; extracting them to a package would weaken ownership
without creating reuse.

The Android output is built with Bun as a build-time bundler but executes under
Termux's packaged Node. It contains no Bun runtime or native Kunai executable.
The build rejects Bun imports/APIs, a-Shell modules, desktop app modules, Ink,
React, SQLite, tests, plans, and archived experiments from the Android graph.

The iOS output is a browser-targeted IIFE. The build rejects Node, Bun,
Android, native, SQLite, Ink, React, tests, plans, and archived experiments from
the iOS graph. It also scans emitted JavaScript and executes the IIFE against a
fake JavaScriptCore host.

On iOS the launcher never places raw user arguments in `jsc` source. It writes
at most 32 arguments to fixed private files, publishes the count last, invokes
only `jsc ./kunai-mobile-ios.js`, and requires observable cleanup before the
application receives the values. Signal and exit traps remove interrupted
transport files.

## Build and artifact contract

From a trusted clean checkout:

```sh
bun install --frozen-lockfile
bun run --cwd apps/mobile typecheck
bun run --cwd apps/mobile lint
bun run --cwd apps/mobile build
bun run --cwd apps/mobile test:unit
bun run --cwd apps/mobile test:integration
```

The ignored `apps/mobile/dist` directory contains:

```text
android/kunai-mobile-android.mjs
ios/kunai-mobile
ios/kunai-mobile-http
ios/kunai-mobile-ios.js
ios/kunai-mobile-open-vlc
ios/kunai-mobile-read-line
mobile-build-meta.json
```

`mobile-build-meta.json` schema 2 records the release version, target graph,
individual SHA-256/raw/gzip measurements, and a canonical digest for each
platform artifact set. The integration suite independently recalculates these
values, verifies executable modes and graph restrictions, starts the Android
artifact with real Node, exercises SIGINT at its real prompt, validates the
evidence CLI, and runs the iOS fake-host workflow.

The Android bundle is one artifact across Termux architectures. That removes
the approximately 90 MB per-architecture Bun standalone runtime and its
unqualified Android ELF hardening from this application. It does not transfer
trust blindly: qualification records the installed Termux and Node versions,
and production support still requires an explicit native-runtime security
decision for the Node package actually used on-device.

## Security invariants

- Accept only absolute credential-free HTTPS URLs without fragments or control
  characters.
- Bound HTTP to 8 seconds, three HTTPS-only redirects, and 64 KiB.
- Pass media URLs as one opaque process argument; never evaluate a constructed
  shell string.
- Android uses `spawn` with `shell: false`; explicit VLC handoff can use only
  `termux-am` or `/system/bin/am`.
- iOS uses a literal helper allowlist and fixed private files.
- Android state directories are forced to `0700` and state files to `0600`.
- Logs, state, metadata, and review evidence contain no URLs, headers, cookies,
  tokens, install identifiers, or raw device logs.
- Unknown evidence fields, stale versions, wrong targets, mismatched artifact
  sets, duplicate rows, emulators, failed observations, and false playback are
  rejected.

The docs dependency graph must also remain audit-clean. A vulnerability that is
absent from the shipped mobile artifact can still affect contributor or CI
builds and is not waived merely because it is development-only.

## Qualification boundary

The opt-in gate accepts exactly two schema-2 evidence files and binds them to
the generated metadata:

```sh
bun run test:live:mobile-host-proof -- \
  --metadata apps/mobile/dist/mobile-build-meta.json \
  --evidence /path/to/android.json \
  --evidence /path/to/ios.json
```

It requires one passing physical Android ARM64 row and one passing physical
iPhone ARM64 row. It validates the claims and artifact bindings; it does not
control devices or independently observe video.

Follow the copy-paste installation, debugging, recovery, performance, evidence,
and cleanup procedures in [mobile-device-lab.md](./mobile-device-lab.md).
Android Emulator and iOS Simulator results are diagnostic only.

## Remaining path to parity

This host-proof slice deliberately excludes catalog/search, anime and TMDB
identity, provider resolution, episode/source/quality selection, playback
progress, and supported distribution. Each future capability must enter through
portable application contracts, make an explicit decision for both identity
lanes and every provider, and repeat physical qualification with real resolved
streams.

TV work remains deferred and is not implied by either mobile adapter.

## Appreciation and influences

[ani-cli](https://github.com/pystardust/ani-cli) demonstrated the practicality
of terminal discovery followed by native-player handoff on mobile. Kunai uses
an independent TypeScript core and stricter runtime, URL, state, and evidence
boundaries, but that project materially informed this direction.

The preview also depends on work from
[Termux](https://github.com/termux/termux-app),
[a-Shell](https://github.com/holzschu/a-shell),
[Node.js](https://nodejs.org/), [Bun](https://github.com/oven-sh/bun), and
[VLC](https://www.videolan.org/vlc/). These are dependencies or host
environments, not endorsements. Recheck their current installation guidance,
licenses, and runtime behavior before publishing artifacts.
