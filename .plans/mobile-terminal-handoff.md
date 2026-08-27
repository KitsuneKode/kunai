---
status: approved
owner: playback-and-distribution
lastReviewed: "2026-08-27"
---

# Mobile Terminal Handoff

## Decision

The first mobile PR ships an Android Termux preview from Kunai's existing
`apps/cli/src/main.ts` entrypoint. It cross-compiles Bun/Bionic executables and
hands qualified direct streams to an installed Android player through
`ACTION_VIEW`. VLC and mpv-android are supported player choices.

iOS remains a separately named feasibility gate. A Bun executable cannot run in
stock iSH or a-Shell, and this repository will not add a second runtime
entrypoint or claim iOS parity without a physical-device proof for a supported
runtime. The preferred next experiment is a Node-compatible bundle in iSH;
shell/Python provider duplication is a fallback requiring its own approved
design.

This design does not add a native mobile app, media proxy, public relay, or
second Kunai entrypoint.

## Product contract

Android Mobile Lite supports this complete flow:

```text
launch Kunai in Termux
  -> browse/search in the existing shell
  -> select title, episode, provider, source, and quality
  -> qualify the resolved stream for the chosen external player
  -> hand the stream to VLC, mpv-android, or the Android chooser
  -> return to Kunai's post-play surface
```

The handoff proves only that Android accepted the launch request. It does not
prove that media started, remained playable, reached EOF, or was watched.
Kunai must never infer progress, completion, autoplay eligibility, queue
acknowledgement, or provider health from a detached handoff.

The user-visible message is explicit: the stream was opened externally and
Kunai cannot observe playback progress. Existing explicit mark-watched and
queue actions remain user-owned; no automatic write substitutes for missing
player evidence.

## Scope

### Included

- Android ARM64 and x64 Bun/Bionic release targets.
- Android detection across build, installer, updater, npm launcher/platform
  packaging, diagnostics, release archives, checksums, and release contracts.
- `--player auto|mpv|vlc`, parsed by the only entrypoint and consumed by player
  composition.
- An explicit detached-playback capability model.
- Android intent launch plans constructed as argument arrays, never shell
  strings.
- Generic Android chooser handoff for `auto`.
- Package-targeted VLC (`org.videolan.vlc`) and mpv-android (`is.xyz.mpv`)
  handoff.
- Direct remote HTTP(S) streams that do not require player-side headers,
  cookies, yt-dlp, a deferred locator, or a media relay.
- Visible rejection or warning for every unsupported stream fact.
- Deterministic unit, contract, integration, archive, installer, updater, and
  documentation tests.
- Opt-in real Android and player smoke instructions using isolated HOME/XDG
  roots.

### Deferred

- Progress observation, automatic completion, autoplay, auto-skip, and live
  recovery after an external player starts.
- Android downloads and offline-library file handoff.
- External subtitle delivery unless the exact target player's documented intent
  contract is implemented and proven on a real device.
- Player-side custom headers, cookies, referrers, or origins.
- YouTube streams whose final playback requires yt-dlp integration inside the
  player.
- 32-bit ARM Android; Bun publishes no matching Android target.
- iOS distribution, iSH runtime compatibility, and VLC iOS handoff.
- Android TV, tvOS, Tizen, webOS, Roku, and consoles.

## Approaches considered

### Chosen: one playback interface, distinct observed and detached results

Keep the existing `PlayerService` seam and add explicit player capabilities plus
a detached Android adapter. `PlaybackResult` gains a discriminant for an
external handoff. The playback policies branch on that discriminant before
reading progress or EOF facts.

This keeps the existing shell, provider engine, source inventory, container,
and single entrypoint while concentrating platform variance in the player
implementation. The interface remains small for callers and the Android
adapter hides command selection, package targeting, URL validation, and launch
failure classification.

### Rejected: fork a separate mobile playback flow

A second playback phase would avoid changing `PlaybackResult`, but it would
duplicate title/episode/provider/source selection and immediately drift from
browse, command-palette, queue, and post-play behavior. It also conflicts with
the single-entrypoint rule.

### Rejected: local or hosted media proxy

A proxy could inject headers and make more provider streams playable, but it
would violate the metadata-only relay contract, increase security and bandwidth
risk, and turn a direct-stream product into a media service. Unsupported streams
must fail closed instead.

## Runtime design

### Player identity and selection

The CLI accepts:

```text
--player auto
--player mpv
--player vlc
```

`auto` means:

- Android: use a generic `ACTION_VIEW` chooser and require an Android intent
  launcher.
- Linux, macOS, and Windows: preserve the current managed mpv behavior.

`mpv` means:

- Android: target the public mpv-android package through `ACTION_VIEW`.
- Desktop: preserve the current managed mpv process and IPC session.

`vlc` means:

- Android: target the public VLC package through `ACTION_VIEW`.
- Desktop: unsupported in this PR; the dependency gate explains the supported
  surface rather than silently falling back to mpv.

The flag defaults to `auto`. It has a complete reader in container/player
composition, appears in help and generated CLI documentation, and rejects
unknown values before storage or provider bootstrap.

### Player capabilities

The player interface exposes immutable capabilities sufficient for policy and
presentation:

```text
observation       managed | detached
customHeaders     true | false
externalSubtitles true | false
localFiles        true | false
progressEvents    true | false
```

Managed mpv advertises its current capabilities. Android handoff advertises
detached observation and no capability that has not been proven through the
target player's public intent contract.

Capabilities are read in the playback dependency gate, session runner,
post-play policies, queue lifecycle, and player-control presentation. They are
not descriptive metadata that can be parsed and dropped.

### Stream qualification

Before external launch, a pure module builds a `HandoffPlan` from `StreamInfo`,
the selected player, and runtime capabilities.

It accepts only:

- absolute HTTP or HTTPS media URLs;
- no non-empty `headers` entries;
- `requiresYtdl !== true`;
- no unresolved `deferredLocator`;
- no local source in the first release.

It reports typed blockers such as:

```text
custom-headers-required
cookies-required
yt-dlp-required
deferred-source
unsupported-scheme
external-subtitle-unsupported
local-source-unsupported
intent-launcher-missing
player-not-installed
launch-rejected
```

External subtitles are never silently dropped. Until a player-specific subtitle
contract is proven, a selected external subtitle blocks launch and tells the
user to choose an embedded subtitle/source or a managed desktop player.

### Android launch adapter

The Android adapter:

1. Resolves an available launcher from `termux-am`, `am`, then modern
   `termux-open` or legacy `termux-open-url` for chooser-only handoff.
2. Validates the URL before spawning.
3. Builds a fixed argument array for `android.intent.action.VIEW` and
   `video/*`.
4. Adds a package selector only for explicit VLC or mpv choices.
5. Captures spawn/exit errors as typed launch rejection.
6. Returns immediately after Android accepts the command.

No command is interpolated into a shell. Debug output redacts URL query values
and does not log cookies or provider tokens.

### Playback result and policies

`PlaybackResult` distinguishes:

```text
observed player result
external handoff accepted
external handoff rejected
```

An accepted handoff carries the selected player and launcher but carries no
watched seconds, duration, EOF, clean-player-exit, or trusted progress evidence.

Policies apply these rules before any existing progress logic:

- no history progress or completion write;
- no playback event write that claims media started;
- no provider success/failure inference after handoff;
- no autoplay or near-EOF behavior;
- no auto-skip or player-control commands;
- no queue acknowledgement that requires `playback-started`;
- any claimed queue row is restored to pending after the detached launch;
- the shell moves to post-play with detached-playback copy.

The existing mpv path and its playback evidence remain unchanged.

## Platform and distribution design

Android is modeled explicitly rather than normalized to Linux:

```text
os: android
arch: arm64 | x64
libc: bionic
targets:
  bun-linux-arm64-android -> kunai-android-arm64
  bun-linux-x64-android   -> kunai-android-x64
```

Every consumer of `RELEASE_BINARY_TARGETS` is updated together:

- binary compilation and build metadata;
- tar.gz archives and checksum manifests;
- GitHub release asset contracts;
- npm optional platform packages and launcher resolution;
- installer target resolution;
- binary updater and rollback metadata;
- release confirmation and documentation tables.

The POSIX installer detects Termux/Android before generic Linux. It never
selects glibc or musl for Android. It installs within Termux-owned executable
storage, never shared `/sdcard` storage, and does not attempt to install desktop
mpv. It reports VLC/mpv-android as external application prerequisites and
reports `termux-am` guidance when the platform requires it.

## Provider decisions

Production providers remain exactly those returned by
`loadProductionProviderModules()`. The mobile player does not create a second
registry.

Each resolved stream is qualified individually; a provider is not globally
declared mobile-safe merely because one source once worked. The initial real
device matrix covers Videasy, VidLink, RiveStream, AniDB, AllManga, Miruro, and
YouTube in both anime and TMDB lanes where applicable.

Provider-side subprocesses remain capability-driven:

- `curl` and curl-impersonate may still be used from Termux;
- `yt-dlp` may still be used for provider metadata or resolution;
- a final stream requiring yt-dlp inside the external player is rejected;
- missing optional tools produce current provider failure/fallback behavior.

## User data, analytics, and security

- Android uses `getKunaiPaths()` and the Termux HOME/XDG environment; no
  `~/.config` path is hardcoded.
- Tests and smokes use isolated `storageRootEnv`; `KUNAI_CONFIG_DIR` is never
  treated as an override.
- No test or debug run points at the developer's live SQLite databases.
- Mobile installation and non-interactive paths never enable analytics, create
  an analytics `installId`, or permit a send.
- `providerRelay.baseUrl` remains empty by default and user-owned.
- The relay remains metadata-only; stream URLs stay direct.
- Intent commands use argument arrays and accept only validated HTTP(S) URLs.

## Entry-point and reverse-state decisions

- The only entrypoint remains `apps/cli/src/main.ts`.
- `--player` is visible in help and consumed during player composition.
- `--player auto` reverses an explicit player choice for a single run.
- Browse, search-on-launch, direct TMDB id, anime mode, provider fallback, and
  post-play reach the same player seam.
- Command-palette and hotkey actions that require managed playback are disabled
  with an explanation while detached mode is active.
- Queue, offline, trailer, and YouTube behavior each receive explicit tests or
  explicit unsupported outcomes; none are inherited accidentally.

## Testing strategy

### Deterministic tests

- CLI parser/help accepts all player choices and rejects unknown values.
- Player selection chooses managed mpv on desktop and Android handoff on
  Android.
- Capability policy prevents unsupported controls and progress inference.
- Handoff planning accepts direct headerless HTTP(S) streams.
- Handoff planning rejects headers, cookies, yt-dlp, deferred locators, local
  files, invalid schemes, and unsupported external subtitles.
- Android command plans cover chooser, VLC, mpv-android, launcher precedence,
  missing launchers, hostile URLs, and redacted diagnostics.
- Playback-result policy never converts a handoff into watched/completed/EOF,
  fallback, provider health, or autoplay evidence.
- Queue claims return to pending without fake playback-start evidence.
- Linux, macOS, and Windows mpv behavior remains characterized.
- Target, archive, checksum, npm launcher, updater, rollback, installer, and
  release-count contracts include both Android targets.
- Architecture boundary and contract-conformance tests cover every new field's
  reader.

### Build verification

- Cross-compile both Android targets from the production entrypoint.
- Inspect artifacts and archives without executing them on the host.
- Measure binary and archive size independently from desktop targets.
- Run root typecheck, lint, formatting, tests, build, doc paths, and build
  pipeline verification using the repository commands.

### Real-device gates

The PR can merge as an experimental preview only after evidence is recorded for
at least one ARM64 Android device. General availability requires the supported
minimum, a middle Android version, and the current Android version.

Each device gate uses an isolated HOME/XDG root and covers:

- binary startup, help, version, and cold start;
- Ink input, raw keys, resize, suspend, and resume;
- SQLite creation/WAL/reopen in Termux storage;
- fetch/TLS/DNS and `Bun.spawn`;
- embedded assets and provider WASM;
- VLC chooser and package-targeted VLC launch;
- mpv-android package-targeted launch;
- a headerless HLS/direct stream for each qualifying provider family;
- rejection copy for a header-dependent stream;
- return-to-shell behavior and absence of fake progress/history writes;
- analytics remaining disabled in interactive and non-interactive setup.

The deterministic suite, Android runtime, live provider, external player, real
terminal, installer, and release-approval gates are reported separately.

### Implementation status (2026-08-27)

The release-target, installer/npm, player-selection, stream-qualification,
intent-launcher, detached-result, queue, post-play, and deterministic contract
work is implemented on `feat/mobile-terminal-handoff`. Android cross-build and
repository gates still need final evidence. Physical Android runtime, VLC,
mpv-android, real providers, terminal lifecycle, SQLite WAL/reopen, install
reliability, cold start, responsiveness, memory, and release approval remain
unverified and block promotion beyond experimental preview.

## Documentation ownership

The implementation updates the current owners in the same change set:

- `.docs/architecture.md`
- `.docs/runtime-boundary-map.md`
- `.docs/providers.md`
- `.docs/testing-strategy.md`
- `.docs/release-reliability-gate.md`
- `.docs/quickstart.md`
- generated user CLI/provider/distribution documentation
- `.plans/roadmap.md`

When the Android core lands, this plan moves to `.archive/plans/` and the
roadmap retains only the iOS/device-qualification residue.

## Acceptance

The PR is complete only when:

1. Android is explicit in every release/distribution reader.
2. The production entrypoint cross-compiles ARM64 and x64 Bionic artifacts.
3. A direct, headerless stream can be handed to VLC and mpv-android on a real
   ARM64 Android device.
4. Unsupported stream facts fail visibly and never fall through to a broken
   launch.
5. Handoff never creates playback-start, progress, completion, EOF, autoplay,
   provider-health, or queue-acknowledgement evidence.
6. Desktop mpv behavior remains unchanged under deterministic and real-mpv
   checks.
7. Analytics and relay contracts remain intact.
8. Every applicable declaration, reverse state, entrypoint, lane, provider,
   platform, and documentation seam has a recorded decision.
9. iOS is described only as unverified follow-up work unless a separate approved
   design and physical-device evidence exist.
