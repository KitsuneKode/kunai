---
status: review
owner: mobile-runtime
lastReviewed: "2026-08-31"
dependsOn: feat/mobile-terminal-handoff
---

# Mobile App Runtime

## Decision

Kunai will add `apps/mobile`, a terminal-first TypeScript application for
Android and iOS. It is one product and one application core with two release
artifacts chosen for the runtime each platform can support honestly:

```text
                         apps/mobile
                    shared TypeScript core
                              |
              +---------------+---------------+
              |                               |
        Android artifact                  iOS artifact
     Bun/Bionic executable            conservative JS bundle
              |                               |
           Termux                    a-Shell mini JavaScriptCore
              |                               |
     Android ACTION_VIEW                  VLC URL handoff
      VLC or mpv-android
```

Android does not install Node, Bun, QuickJS, or Python. iOS does not pretend a
macOS executable is an iOS binary. QuickJS is a possible Android fallback for
an architecture without a published executable, not the primary runtime.

The app keeps stream resolution local. It adds no native Kunai application,
public resolver, media proxy, shared relay URL, or media relay route. VLC and
mpv receive direct provider URLs only.

This design supersedes the iOS runtime direction in
[`mobile-terminal-handoff.md`](./mobile-terminal-handoff.md). It depends on
that work's Android target and detached-playback evidence, but does not turn
the draft Android PR into a device-qualified release.

## Product contract

The first supported mobile journey is:

```text
launch kunai-mobile
  -> choose anime or movies/series lane
  -> search
  -> choose title
  -> choose episode when applicable
  -> resolve through an explicitly mobile-qualified provider
  -> choose a playable source/quality
  -> qualify the stream against the selected external player
  -> hand the direct URL to VLC, mpv-android, or the Android chooser
  -> return an honest detached-handoff result
```

An accepted handoff proves only that the operating system accepted the open
request. It does not prove playback start, progress, completion, EOF, or
provider success. Mobile v1 therefore records recent selections and explicit
favorites, but never automatically writes watched progress or completion.

## Success criteria

Mobile support is real only when all of these are true:

- The same application behavior is covered through a runtime-neutral test
  surface.
- Android ARM64 and x64 artifacts cross-build and install in isolated Termux
  state.
- The iOS artifact runs in the current App Store a-Shell mini without Node,
  Python, an Alpine userland, or an on-device package install.
- A physical Android device and physical iPhone each complete search through
  VLC handoff with a currently qualified provider.
- Unsupported streams fail before player launch with a typed, actionable
  reason.
- No test, installer, or smoke touches the developer's real Kunai profile.
- Deterministic, artifact, terminal, live-provider, and physical-device gates
  are reported separately.

Cross-build success alone must never change public platform support claims.

## Scope

### Mobile v1

- One `apps/mobile` source tree and one application interface.
- Android ARM64 and x64 Bun/Bionic executables.
- One conservative JavaScript bundle for a-Shell mini JavaScriptCore.
- A small POSIX launcher/installer per platform; application logic stays in
  TypeScript.
- Numbered, line-oriented terminal selection with basic ANSI color and a
  no-color mode. No Ink, alternate screen, poster protocol, or required fzf.
- Anime search plus movie/series search through a shared portable catalog
  module. The first host proof may exercise one lane, but both lanes are
  required before the mobile v1 support claim.
- Title, episode, provider, source, quality, and player selection.
- VLC on iOS and Android; mpv-android and the Android chooser on Android.
- Local JSON config, favorites, and recent selections.
- Version, help, doctor, and redacted debug output.
- Versioned, checksummed release artifacts; atomic update, rollback, and
  uninstall within each terminal application's sandbox.
- An explicit mobile provider registry populated only by evidence.

### Deferred until separately proven

- Watched progress, automatic completion, autoplay, queue acknowledgement,
  auto-skip, track control, or post-EOF behavior.
- Background iOS execution and Shortcuts support. Foreground terminal behavior
  is the first contract.
- Downloads, offline library, local file handoff, and external subtitle files.
- Player-side cookies, arbitrary request headers, referrers, or origins.
- Providers requiring browser automation, yt-dlp, an unportable native module,
  or unavailable TLS impersonation.
- Account sync, analytics, Discord presence, posters, and the desktop command
  palette.
- Android TV, tvOS, Tizen, webOS, Roku, and consoles.

## Approaches considered

### Chosen: shared TypeScript application, platform-specific artifacts

The application shares behavior and tests while each platform gets the
strongest available host. Android uses a compiled Bun executable. iOS uses a
plain JavaScript bundle under a-Shell mini's built-in `jsc` command.

This avoids making runtime identity the product abstraction. The stable
abstraction is the mobile application's behavior and its small host seams.

### Follow-up candidate, not primary: QuickJS-ng on Android

QuickJS-ng is available in Termux and could run a portable bundle, but it adds
an Android package, gives up Bun's qualified Android implementation, and still
requires different OS adapters. The host proof measured Bun/Bionic artifacts
at roughly 90–92 MB raw and 36–38 MB gzip, while stripping recovered only about
0.07 percent on x64. That makes a QuickJS-ng composition worth a bounded
Android-lite spike after the Bun host is physically qualified. It remains an
opt-in fallback experiment—not a v1 dependency or support promise—until the
same physical matrix proves both the smaller payload and the extra install step.

### Rejected: POSIX shell owns the application

ani-cli proves a small shell program can reach many platforms. Reimplementing
Kunai's provider and domain behavior through `sed`, `grep`, and shell state
would discard its typed contracts, make complex crypto brittle, and create a
second provider implementation. Shell is appropriate for installation,
platform detection, terminal bridging, and last-mile player launch only.

### Rejected: Node in iSH

iSH emulates an i386 Alpine environment and its current ani-cli installation
requires a substantial package set. It cannot provide a supported Bun runtime,
and making it the primary iOS path increases installation weight while reducing
performance and compatibility.

### Rejected: PWA or hosted resolver

A browser cannot reliably call all provider endpoints because of CORS and
cannot bypass the limitation without a server. A hosted resolver changes the
local-first product and security model. The relay remains metadata-only,
user-owned, and empty by default; it is not a media fallback.

### Rejected: native wrapper

Capacitor, React Native, Tauri, LiquidCore, or a custom JavaScriptCore host
would make Kunai a native mobile application with App Store distribution and
review obligations. That is outside the requested terminal-first scope.

## Monorepo and entrypoint decision

The existing rule that `apps/cli/src/main.ts` is the only entrypoint conflicts
directly with an independent `apps/mobile`. Implementation must update it
explicitly rather than evade it with a misleading filename:

> `apps/cli/src/main.ts` is the only desktop CLI entrypoint.
> `apps/mobile` owns one separately declared mobile entrypoint and may not
> import from `apps/cli`.

The dependency direction is:

```text
apps/cli    -----> shared packages <----- apps/mobile
    X                                      X
    +------------ no cross-app imports ---+
```

Architecture tests must enforce:

- `apps/mobile` imports no file under `apps/cli`.
- `apps/cli` imports no file under `apps/mobile`.
- `apps/mobile` imports no Ink or React runtime.
- the iOS graph imports no `bun:*`, `node:*`, native module, or SQLite package;
- active runtime code imports neither `.archive/legacy` nor
  `.reference/experiments`.

The entrypoint exception is changed only in the implementation PR that creates
the entrypoint, never as a promise in advance.

## Module design

### External application interface

`apps/mobile` is one deep module. Its callers and end-to-end tests use one
interface:

```ts
type MobileEnvironment = {
  readonly http: MobileHttpPort;
  readonly state: MobileStateStore;
  readonly terminal: MobileTerminalPort;
  readonly player: MobilePlayerPort;
  readonly catalog: MobileCatalogPort;
  readonly providers: readonly CoreProviderModule[];
};

type MobileApplicationInput = {
  readonly argv: readonly string[];
  readonly environment: MobileEnvironment;
};

type MobileExit = {
  readonly code: number;
  readonly reason: "completed" | "cancelled" | "handoff" | "invalid-input" | "failed";
};

function runMobileApplication(input: MobileApplicationInput): Promise<MobileExit>;
```

This is the supported-v1 shape, not permission to add unread dependencies.
The fixture-only host proof begins with HTTP, state, terminal, and player ports.
Catalog and provider fields are added only in the tasks that consume them, so
the first slice cannot ship dormant declarations.

Argument parsing, navigation, provider orchestration, source selection,
qualification, persistence decisions, and error presentation stay behind this
interface. Callers do not assemble the workflow themselves.

### Internal seams

Platform variation justifies four internal seams, each with Android, iOS, and
in-memory test adapters:

```ts
interface MobileHttpPort {
  request(request: MobileHttpRequest): Promise<MobileHttpResponse>;
}

interface MobileStateStore {
  load(): Promise<MobileState>;
  commit(next: MobileState): Promise<void>;
}

interface MobileTerminalPort {
  render(view: MobileView): Promise<void>;
  choose(request: MobileChoiceRequest): Promise<MobileChoiceResult>;
}

interface MobilePlayerPort {
  capabilities(): MobilePlayerCapabilities;
  handoff(request: MobilePlaybackRequest): Promise<MobileHandoffResult>;
}
```

These are internal seams, not a new general-purpose runtime framework. The
application interface is the primary test surface. Adapter-specific tests
cover only platform mechanics.

Do not add a broad `MobileRuntime` bag whose interface exposes every low-level
operation to every caller. Composition creates the four adapters once and
passes them to the application implementation.

### Shared package ownership

- `@kunai/types` continues to own serializable provider/media contracts.
- The detached observation and player capability facts currently useful to
  both apps move to `@kunai/types` only if they cross the app/package seam.
- Pure stream-to-handoff qualification moves to `@kunai/core` when both apps
  consume it; it must not be copied into `apps/mobile` and `apps/cli`.
- `@kunai/providers` owns provider extraction and accepts the existing fetch
  port plus any narrowly justified portable crypto/clock dependencies.
- A new `@kunai/catalog` package is justified only when CLI and mobile migrate
  in the same extraction. It owns portable AniList/TMDB request and
  normalization behavior, not terminal presentation or app policy.
- `apps/mobile` owns navigation, presentation, JSON state, runtime composition,
  and player adapters.
- `apps/cli` keeps Ink, SQLite orchestration, managed mpv, and desktop policy.

The deletion test applies: removing a shared module should force meaningful
logic back into both apps. Pass-through wrappers do not become packages.

## Proposed source layout

```text
apps/mobile/
  package.json
  tsconfig.json
  src/
    entry.ts
    application/
      run-mobile-application.ts
      mobile-navigation.ts
      mobile-views.ts
    catalog/
      anime-catalog.ts
      tmdb-catalog.ts
    providers/
      load-mobile-provider-modules.ts
      mobile-provider-compatibility.ts
    runtime/
      composition.ts
      http-port.ts
      state-store.ts
      terminal-port.ts
      player-port.ts
      android/
      ashell/
    storage/
      mobile-state.ts
      mobile-state-codec.ts
  scripts/
    build.ts
    install-android.sh
    install-ios.sh
  test/
    unit/
    integration/
    fixtures/
    live/
```

`entry.ts` is the one declared entrypoint for this app. No second debug,
installer, or live-smoke entrypoint is added to the production graph. Test and
script files are not runtime entrypoints.

## Runtime adapters

### Android Bun adapter

The Android artifact uses Bun's Bionic build targets already modeled by the
dependent branch. It may use Bun APIs only behind Android adapters:

- `fetch` for provider requests;
- `Bun.file`/`Bun.write` or the established atomic-write semantics for mobile
  JSON state;
- fixed argument arrays for `am`/`termux-am` player launch;
- cancellation and deadlines mapped to `AbortSignal`.

The application and provider domain code must not depend on those Bun APIs.

Primary artifacts:

```text
kunai-mobile-android-arm64
kunai-mobile-android-x64
```

### iOS a-Shell adapter

The iOS artifact targets the conservative ECMAScript subset proven by the
current a-Shell mini `jsc` runtime. The build is a single bundled script with:

- no dynamic import;
- no top-level await requirement;
- no Node or Bun built-ins;
- no native addons;
- no runtime npm installation;
- bundled, audited polyfills only where the physical runtime probe proves they
  are necessary.

a-Shell supplies printing, filesystem helpers, command execution, and bundled
`curl`. The adapter owns all use of the `jsc` global. The application never
touches it directly.

The current a-Shell mini source ships `jsc`, `jsc_core`, `curl`, `openurl`, and
the required file commands, but documents no stable JavaScript stdin/readline
API. The terminal adapter therefore invokes one fixed, installed
`kunai-mobile-read-line` helper through `jsc.system()`. That helper performs
only `IFS= read -r` and writes the answer to an app-owned file; the TypeScript
application still owns every prompt, choice, validation, back, and cancel
decision. The command string is constant and contains no provider or user data.
The host proof must validate this blocking bridge and Ctrl+C recovery on a
physical iPhone. It must not use the explicitly unstable private `term_` API.
The foreground launcher must not pass raw arguments to `jsc`: a-Shell builds
JavaScript source from that command boundary before Kunai validation runs. It
stages a bounded argument vector as separately numbered, mode-private files,
publishes the count last, and invokes `jsc` with only the fixed bundle path. The
adapter reads and deletes the complete transport before parsing it. Missing,
malformed, excessive, or undeletable staging fails closed. The iOS source graph
and emitted bundle may not use any Node-style `process` API.

Primary artifacts:

```text
kunai-mobile-ios.js
kunai-mobile-ios.sh
```

The foreground terminal is the v1 execution contract. Background/Shortcuts
behavior is not implied by the artifact compiling.

## HTTP and command security

### Android

The Android HTTP adapter uses Bun `fetch` with explicit deadlines, redirect
limits, response-size limits, and redacted diagnostics.

### iOS

The a-Shell adapter uses bundled `curl` because JavaScriptCore and WKWebView do
not provide one stable cross-origin Fetch contract for this use case.

Untrusted provider data is never interpolated into a shell command. The
adapter:

1. accepts only absolute HTTPS URLs;
2. rejects NUL, CR, LF, and invalid header names/values;
3. writes an app-owned curl config and request body under a fixed private
   working directory;
4. invokes a fixed helper command whose arguments contain only validated,
   app-generated paths;
5. restricts initial and redirect protocols to HTTPS;
6. caps redirects, time, and response bytes;
7. parses status and headers from separate files;
8. deletes request secrets and temporary responses on success, cancellation,
   and failure;
9. redacts query values, cookies, authorization, and provider tokens from
   diagnostics.

The physical runtime proof must demonstrate that interactive output continues
to render while HTTP work occurs and that cancellation returns the terminal to
a usable state.

## Provider compatibility

`apps/mobile/src/providers/load-mobile-provider-modules.ts` is the single
mobile registry. A provider existing in `@kunai/providers`, being marked
`browserSafe`, or being present in the desktop production registry does not
make it mobile-supported.

Each candidate provider receives a recorded decision for both platforms:

```text
portable imports
HTTP adapter behavior
required crypto
required compression
TLS/impersonation requirement
final stream header/cookie requirement
VLC iOS result
VLC Android result
mpv-android result
```

The portability audit names every production provider returned by the current
desktop registry: Videasy, VidLink, RiveStream, AniDB, AllManga, Miruro, and
YouTube. Each receives `supported`, `deferred`, or `rejected` status with
evidence; none inherits support implicitly from the desktop registry.

The initial registry starts empty in deterministic tests. A fixture provider
proves the runtime and application flow. The first production provider is
chosen only after the portability audit and live-device evidence; VidLink is a
candidate, not a pre-approved choice.

Provider portability work follows these rules:

- use `ProviderRuntimeContext.fetch` rather than global `fetch`;
- replace `Bun.sleep` with an injected clock only where the provider needs it;
- replace `Bun.hash` IDs with a stable portable hash in one shared owner;
- use `Uint8Array` and explicit base64 helpers rather than ambient `Buffer`;
- add a crypto port only when two real adapters are required;
- reject process-spawning providers on iOS rather than hiding a shell command
  inside provider code;
- preserve ani-cli parity safeguards around AllManga crypto;
- never broaden the desktop registry as a side effect of mobile support.

Provider declarations must have readers. If a mobile capability field is
introduced, the mobile registry consumes it and contract-conformance tests
fail when it is ignored.

## Catalog lanes

Anime and TMDB identities remain distinct:

- After the host proof, `@kunai/catalog` becomes a deep shared module consumed
  by both apps. It owns portable AniList/TMDB request construction, validation,
  normalization, error classification, and bounded caching.
- Anime preserves AniList identity and 1-based absolute episode identity at the
  UI seam.
- Movie/series preserves TMDB kind, season, and episode identity.
- The current TMDB credential is documented as a public application key, not a
  user secret. The extraction may preserve the current proxy/direct fallback
  and explicit user override, but diagnostics must redact query values and no
  account or private credential may enter the iOS bundle.
- The package is created only if the CLI migrates to it in the same slice. If
  that extraction cannot stay narrow, stop rather than duplicate the CLI
  catalog implementation under `apps/mobile`.

`apps/mobile` never imports the CLI catalog implementation directly. A fixture
catalog is enough for the host proof, but both catalog lanes are required before
mobile v1 is described as supported.

## Player handling

The portable handoff planner accepts only streams the selected adapter can
represent. Mobile v1 requires:

- absolute HTTPS URL;
- no unresolved locator;
- no yt-dlp requirement;
- no cookies or custom player headers;
- no external subtitle file unless the exact player contract is later proven;
- no local file.

Android player adapters build fixed argument arrays for:

- VLC package `org.videolan.vlc`;
- mpv-android package `is.xyz.mpv`;
- the generic `ACTION_VIEW` chooser.

iOS attempts the qualified VLC URL scheme through a-Shell's open command and
renders an OSC 8 tappable `vlc://` link as fallback. URL encoding and maximum
safe URL length require device tests. Player presence cannot be inferred from
the terminal; launch failures and user cancellation remain distinct results.

Every accepted mobile handoff returns detached capabilities and contains no
duration, watched seconds, progress, completion, EOF, or provider-health fact.

## State and privacy

Mobile state is a versioned JSON document owned by `apps/mobile`, not a second
SQLite schema. It contains only:

- schema version;
- player and quality preferences;
- explicit favorites;
- recent selections/handoffs;
- update metadata;
- user-entered catalog configuration where required.

It does not contain watched progress in v1. Writes are atomic and recover from
an interrupted replacement without reading the desktop database.

Analytics is absent from mobile v1. Installation, first run, skipped setup, or
non-interactive execution must not create an install ID or send a request.
Provider URLs, tokens, and request headers never enter persistent diagnostics.

## Terminal interface

The mobile interface is line-oriented and touch-terminal friendly:

```text
Search: Frieren

1. Frieren: Beyond Journey's End
2. Frieren: Journey's End
0. Cancel

Select title: 1
```

Required behavior:

- numbered choices work without fzf;
- empty, invalid, cancel, EOF, and Ctrl+C paths are explicit;
- pagination never requires precise cursor keys;
- all essential information is text, not color alone;
- `NO_COLOR` and non-TTY output are supported;
- stream URLs and secrets are never printed outside explicit redacted debug
  mode;
- the iOS interface does not depend on a-Shell's unstable private terminal DOM.

The canonical installed command is `kunai-mobile` so it can coexist with the
full Android CLI. An installer may offer a `kunai` alias only through explicit
user choice and only when that name is unowned.

## Distribution and updates

The mobile app has its own release asset set while sharing the repository's
release version:

```text
kunai-mobile-android-arm64.tar.gz
kunai-mobile-android-x64.tar.gz
kunai-mobile-ios.tar.gz
SHA256SUMS
```

Installers resolve an immutable version before downloading, verify the exact
asset checksum, stage under the terminal application's private storage, run a
bounded `--version`/`doctor` verification, and atomically activate it. A failed
install preserves the previous version. Update and uninstall acquire the same
lifecycle lock.

Android installs under Termux-owned executable storage, never `/sdcard`. iOS
installs under a-Shell's writable Documents/bin layout. Neither path uses
`sudo`, modifies another app's sandbox, or installs VLC/mpv automatically.

Public docs remain unchanged until physical gates pass. Before qualification,
release artifacts are experimental and the installer requires an explicit
preview channel or version.

## Testing strategy

### Deterministic default tests

- application-interface tests with in-memory HTTP, state, terminal, and player
  adapters;
- navigation and reverse-state tests for cancel, retry, back, and disable;
- provider registry and declaration-to-reader conformance;
- both anime and movie/series lane decisions;
- handoff qualification and detached-evidence policy;
- Android argv construction without executing Android commands;
- iOS curl-config escaping, protocol restrictions, cleanup, and redaction;
- state migration, atomic replacement, corruption recovery, and rollback;
- forbidden-import scan for the iOS graph and built bundle;
- build determinism and release-asset contract tests;
- installer dry-run, checksum rejection, interruption, update, rollback, and
  uninstall in isolated HOME/XDG/AppData/TMPDIR state.

Default tests use no live provider, real sleep, device, player, or developer
profile.

### Runtime conformance

- execute the portable bundle under a local JavaScriptCore-compatible harness
  where available;
- execute the Android app as a normal host bundle with fake adapters;
- scan the iOS bundle for `Bun`, `Buffer`, `node:`, dynamic import, native addon
  edges, and any `process` use;
- preserve fixture parity between desktop and mobile for each shared provider.

A simulator or compatibility engine is supporting evidence, not a substitute
for a-Shell mini on a physical iPhone.

### Opt-in live and physical gates

The live harness records a redacted evidence bundle containing app/runtime
versions, OS version, architecture, player choice, provider, source facts,
handoff result, and timestamps. It never records the raw media URL or headers.

Minimum matrix before a support claim:

| Platform | Terminal                      | Architecture          | Player         | Required evidence                                 |
| -------- | ----------------------------- | --------------------- | -------------- | ------------------------------------------------- |
| iOS      | a-Shell mini App Store build  | physical arm64 iPhone | VLC            | search, resolve, open, playback begins            |
| Android  | supported Termux distribution | physical arm64        | VLC            | install, search, resolve, intent, playback begins |
| Android  | supported Termux distribution | physical arm64        | mpv-android    | install, search, resolve, intent, playback begins |
| Android  | emulator or device            | x64                   | VLC or chooser | artifact start and intent acceptance              |

Provider drift can fail the live gate without invalidating deterministic tests.
Report those states separately.

The build records compressed and installed artifact sizes. The first accepted
host proof establishes reviewed regression ceilings; later unexplained growth
fails the artifact contract. The design does not invent a size promise before
the two real artifacts have been measured.

## Implementation gates

Implementation proceeds in ordered proof slices:

1. **Host proof:** a tiny fixture-only app builds for both targets and proves
   terminal I/O, HTTP, JSON storage, cancellation, and VLC handoff.
2. **Application core:** the full navigation state machine works through fake
   adapters with no provider or device dependency.
3. **Shared handoff extraction:** both apps consume one honest qualification
   module without changing managed mpv behavior.
4. **Provider audit:** record every production provider's mobile decision and
   select one evidence-backed candidate.
5. **Live vertical slice:** one catalog lane and one provider complete the
   physical-device matrix.
6. **Distribution:** installers, artifacts, update/rollback/uninstall, and
   preview documentation land only after the vertical slice.
7. **Second catalog lane:** both anime and TMDB flows pass deterministic and
   physical-device evidence before the mobile v1 support claim.
8. **Expansion:** additional providers, favorites, and player targets are
   independent follow-ups.

If the iOS host proof cannot safely provide interactive I/O, bounded HTTP,
atomic state, and VLC handoff, stop. Do not port providers or weaken the
security model to make the experiment appear successful.

## Hit-every-seam audit

- **Declaration to reader:** mobile provider/capability declarations are
  consumed by the mobile registry and handoff planner.
- **Reverse states:** selection has back/cancel; preferences have reset;
  installation has update/rollback/uninstall; favorites have remove.
- **Entry points:** `apps/mobile` has exactly one runtime entrypoint; installers
  and smokes do not become alternatives.
- **Both lanes:** anime and TMDB have explicit independent decisions; neither
  silently substitutes for the other.
- **Every provider:** each production provider receives a recorded supported,
  deferred, or rejected mobile decision.
- **Every platform:** Android ARM64/x64 and iOS a-Shell are explicit; desktop
  behavior is unchanged and protected by regression tests.
- **Docs:** this plan owns unfinished intent; runtime and user docs change only
  with verified behavior.

## Open review decisions

These decisions must be accepted before implementation planning:

1. The canonical command is `kunai-mobile`, with an optional explicit `kunai`
   alias only when unowned.
2. Both anime and movie/series lanes are required before mobile v1 is called
   supported; the first host or vertical proof may exercise one lane.
3. The existing documented public TMDB application key and proxy/direct
   fallback may move to `@kunai/catalog`; no account or private credential is
   embedded, and query values remain redacted.
4. QuickJS-ng is an Android-lite follow-up candidate, not a required runtime.
5. iOS v1 is foreground a-Shell mini only.
6. The feature branch is stacked on `feat/mobile-terminal-handoff` until the
   Android prerequisite lands or is rebased.
