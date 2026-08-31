# Mobile Terminal Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an experimental Android Termux build that preserves Kunai's existing browse/resolve flow and hands qualified direct streams to VLC, mpv-android, or the Android chooser without fabricating playback evidence.

**Architecture:** Preserve `apps/cli/src/main.ts` as the only entrypoint and the current managed-mpv implementation for desktop. Add an explicit Android platform target, a detached-player adapter at the existing `PlayerService` seam, and pure qualification/policy modules that reject unsupported stream requirements before launching an Android intent.

**Tech Stack:** Bun 1.4 compiled executables, TypeScript, Ink, Bun test, Turborepo, POSIX shell installer, Android `ACTION_VIEW`, VLC Android, mpv-android.

**Spec:** `.plans/mobile-terminal-handoff.md`

## Global Constraints

- Android is a distinct `android`/Bionic platform and must never fall through to Linux glibc or musl.
- The only runtime entrypoint remains `apps/cli/src/main.ts`.
- External handoff proves only that Android accepted a launch command; it never proves playback start, progress, completion, EOF, or provider success.
- Only absolute HTTP(S), headerless, non-deferred, non-yt-dlp final streams qualify initially.
- External subtitles and local files fail visibly until their exact player contracts are proven.
- Command execution always uses fixed argument arrays; no stream value is interpolated into a shell command.
- `providerRelay.baseUrl` remains empty by default and the relay remains metadata-only.
- Analytics remains explicit opt-in; mobile and non-interactive paths must not create an install ID or send.
- Tests use `storageRootEnv`; never use `KUNAI_CONFIG_DIR` or the developer's live databases.
- Deterministic, Android runtime, live provider, VLC/mpv, terminal, installer, and release-approval gates are reported separately.

## File structure

### New focused modules

- `apps/cli/src/domain/playback/player-choice.ts` — canonical player choice parsing and platform default policy.
- `apps/cli/src/domain/playback/player-capabilities.ts` — portable managed/detached capability facts shared by policy and player implementations.
- `apps/cli/src/domain/playback/handoff-plan.ts` — pure stream qualification and typed blocker vocabulary.
- `apps/cli/src/infra/player/android-intent-launcher.ts` — Android launcher discovery and fixed `ACTION_VIEW` argv construction.
- `apps/cli/src/infra/player/handoff-player-service.ts` — detached `PlayerService` adapter and handoff result mapping.
- `apps/cli/src/app/playback/run-playback-session.ts` — one caller-facing session runner that selects observed mpv or detached handoff behavior.
- `apps/cli/test/live/android-terminal-handoff.ts` — opt-in, isolated real-device smoke entrypoint.

### Existing owners modified

- `apps/cli/src/services/update/platform-assets.ts` and release/build scripts — Android artifacts.
- `install.sh`, npm launcher/package metadata, updater contracts — Android installation and resolution.
- `apps/cli/src/cli-args.ts`, `apps/cli/src/main.ts`, and `apps/cli/src/container/*` — declaration-to-reader wiring.
- `apps/cli/src/infra/player/PlayerService.ts` and playback policies — capabilities and honest handoff evidence.
- `apps/cli/src/app/playback/PlaybackPhase.ts` and queue/session helpers — detached behavior and post-play return.
- `.docs/*` and generated user docs — platform contract and verification gates.

---

### Task 1: Model Android release targets

**Files:**

- Modify: `apps/cli/src/services/update/platform-assets.ts`
- Modify: `apps/cli/test/unit/services/update/platform-assets.test.ts`
- Modify: `apps/cli/test/unit/scripts/build-release-archives.test.ts`
- Modify: `scripts/release-asset-contract.ts`
- Modify: `apps/cli/test/unit/scripts/distribution-contract.test.ts`

**Interfaces:**

- Produces: `PlatformOs = "linux" | "darwin" | "windows" | "android"`.
- Produces: `PlatformLibc = "gnu" | "musl" | "bionic"`.
- Produces targets `android-arm64`/`bun-linux-arm64-android` and `android-x64`/`bun-linux-x64-android`.
- Preserves every existing Linux, macOS, and Windows target exactly.

- [ ] **Step 1: Write failing platform tests**

```ts
expect(normalizePlatformOs("android")).toBe("android");
expect(resolveReleaseBinaryTarget("android", "arm64", "bionic")?.triple).toBe(
  "bun-linux-arm64-android",
);
expect(resolveReleaseBinaryTarget("android", "x64", "bionic")?.out).toBe("kunai-android-x64");
expect(releaseAssetName("android", "arm64", "bionic")).toBe("kunai-android-arm64");
expect(resolveReleaseBinaryTarget("linux", "arm64", "bionic")).toBeUndefined();
```

Extend archive/distribution assertions to require two Android raw binaries and
two `.tar.gz` archives rather than hardcoding the previous asset count.

- [ ] **Step 2: Run tests and verify the Android expectations fail**

Run:

```sh
bun run --cwd apps/cli test:file test/unit/services/update/platform-assets.test.ts
bun run --cwd apps/cli test:file test/unit/scripts/build-release-archives.test.ts
bun run --cwd apps/cli test:file test/unit/scripts/distribution-contract.test.ts
```

Expected: failures show Android is not a recognized OS/target and release assets omit both Android variants.

- [ ] **Step 3: Implement the target model**

Add canonical target rows equivalent to:

```ts
releaseBinaryTarget({
  id: "android-arm64",
  triple: "bun-linux-arm64-android",
  out: "kunai-android-arm64",
  os: "android",
  arch: "arm64",
  libc: "bionic",
});
```

Add the x64 peer. Normalize `process.platform === "android"` without treating it as Linux, and require Bionic for Android target resolution.

- [ ] **Step 4: Run focused tests and verify they pass**

Run the three commands from Step 2 plus:

```sh
bunx turbo run typecheck --force
```

Expected: zero failures; existing eight target identities remain unchanged and the canonical set contains ten targets.

- [ ] **Step 5: Commit**

```sh
git add apps/cli/src/services/update/platform-assets.ts apps/cli/test/unit/services/update/platform-assets.test.ts apps/cli/test/unit/scripts/build-release-archives.test.ts apps/cli/test/unit/scripts/distribution-contract.test.ts scripts/release-asset-contract.ts
git commit -m "feat: model Android release targets"
```

### Task 2: Carry Android through packaging, installer, updater, and npm launch

**Files:**

- Modify: `apps/cli/scripts/npm-launcher.mjs`
- Modify: `apps/cli/scripts/build-npm-platform-packages.ts`
- Modify: `apps/cli/scripts/write-npm-publish-manifest.ts`
- Modify: `apps/cli/scripts/verify-npm-pack.ts`
- Modify: `apps/cli/package.json`
- Modify: `scripts/sync-npm-platform-versions.ts`
- Modify: `install.sh`
- Modify: `apps/cli/test/integration/install-scripts.test.ts`
- Modify: `apps/cli/test/unit/scripts/distribution-contract.test.ts`
- Modify: `apps/cli/test/unit/services/update/platform-assets.test.ts`

**Interfaces:**

- Consumes: the ten canonical `RELEASE_BINARY_TARGETS` from Task 1.
- Produces: npm package resolution for `@kitsunekode/kunai-android-arm64` and `@kitsunekode/kunai-android-x64`.
- Produces: Android-first installer detection that selects Bionic before Linux libc detection.

- [ ] **Step 1: Write failing distribution and installer cases**

Add launcher/package expectations equivalent to:

```js
expect(resolveTarget({ platform: "android", arch: "arm64" })).toBe("android-arm64");
expect(resolveTarget({ platform: "android", arch: "x64" })).toBe("android-x64");
```

Add installer harness scenarios with `TERMUX_VERSION` present and injected `uname` output proving:

```text
android/arm64 -> kunai-android-arm64.tar.gz
android/x86_64 -> kunai-android-x64.tar.gz
```

Assert Android dry-run output does not contain desktop mpv package-manager commands and does mention VLC/mpv-android plus `termux-am` guidance.

- [ ] **Step 2: Run focused tests and verify they fail for missing Android consumers**

```sh
bun run --cwd apps/cli test:file test/unit/scripts/distribution-contract.test.ts
bun run --cwd apps/cli test:file test/integration/install-scripts.test.ts
```

Expected: npm optional dependencies, launcher resolution, and installer target selection omit Android.

- [ ] **Step 3: Implement end-to-end Android distribution readers**

Implement Android before generic Linux in `install.sh`. Resolve architecture from `uname -m`, keep downloads/checksums/activation unchanged, install under Termux-owned executable storage, and print external Android-player prerequisites instead of attempting a desktop mpv install.

Update the npm launcher mapping and optional dependency manifest from the canonical target set. Do not add root-level build logic; keep package scripts under `apps/cli` and let Turbo orchestrate them.

- [ ] **Step 4: Synchronize generated platform dependency versions**

```sh
bun run scripts/sync-npm-platform-versions.ts
```

Inspect the resulting `apps/cli/package.json` diff and verify it adds exactly the two Android optional dependencies at the existing package version.

- [ ] **Step 5: Verify focused packaging behavior**

```sh
bun run --cwd apps/cli test:file test/unit/scripts/distribution-contract.test.ts
bun run --cwd apps/cli test:file test/integration/install-scripts.test.ts
bun run --cwd apps/cli pkg:check
bun run verify:build-pipeline:pr
```

Expected: all deterministic distribution contracts pass; no real downloads or user-profile writes occur.

- [ ] **Step 6: Commit**

```sh
git add install.sh apps/cli/package.json apps/cli/scripts/npm-launcher.mjs apps/cli/scripts/build-npm-platform-packages.ts apps/cli/scripts/write-npm-publish-manifest.ts apps/cli/scripts/verify-npm-pack.ts scripts/sync-npm-platform-versions.ts apps/cli/test/integration/install-scripts.test.ts apps/cli/test/unit/scripts/distribution-contract.test.ts apps/cli/test/unit/services/update/platform-assets.test.ts
git commit -m "feat: distribute Android Termux binaries"
```

### Task 3: Add the player choice declaration and reader

**Files:**

- Create: `apps/cli/src/domain/playback/player-choice.ts`
- Create: `apps/cli/src/domain/playback/player-capabilities.ts`
- Create: `apps/cli/test/unit/domain/playback/player-choice.test.ts`
- Create: `apps/cli/test/unit/domain/playback/player-capabilities.test.ts`
- Modify: `apps/cli/src/cli-args.ts`
- Modify: `apps/cli/test/unit/main-args.test.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/container/bootstrap-services.ts`
- Modify: `apps/cli/src/container/types.ts`

**Interfaces:**

- Produces: `type PlayerChoice = "auto" | "mpv" | "vlc"`.
- Produces: `type DetachedPlayerTarget = "chooser" | "mpv" | "vlc"`.
- Produces: `type SupportedPlayerPlatform = "android" | "linux" | "darwin" | "win32"`.
- Produces: `parsePlayerChoice(value: string | undefined): PlayerChoice`.
- Produces a discriminated `PlayerMode` from `resolvePlayerMode({ choice, platform })`:

```ts
type PlayerMode =
  | { readonly kind: "managed-mpv" }
  | { readonly kind: "android-handoff"; readonly target: DetachedPlayerTarget }
  | { readonly kind: "unsupported"; readonly choice: PlayerChoice };

function resolvePlayerMode(input: {
  readonly choice: PlayerChoice;
  readonly platform: SupportedPlayerPlatform;
}): PlayerMode;

interface PlayerCapabilities {
  readonly observation: "managed" | "detached";
  readonly customHeaders: boolean;
  readonly externalSubtitles: boolean;
  readonly localFiles: boolean;
  readonly progressEvents: boolean;
  readonly completion: boolean;
  readonly autoSkip: boolean;
  readonly trackControl: boolean;
}
```

- Produces `PlayerCapabilities` and immutable `MANAGED_MPV_CAPABILITIES`/`DETACHED_HANDOFF_CAPABILITIES` constants.
- Extends `CliArgs` with required `player: PlayerChoice`.

- [ ] **Step 1: Write failing parser and policy tests**

```ts
expect(parseCliArgs(["--player", "vlc"]).player).toBe("vlc");
expect(parseCliArgs([]).player).toBe("auto");
expect(() => parseCliArgs(["--player", "potato"])).toThrow("--player");
expect(resolvePlayerMode({ choice: "auto", platform: "android" })).toEqual({
  kind: "android-handoff",
  target: "chooser",
});
expect(resolvePlayerMode({ choice: "vlc", platform: "linux" })).toEqual({
  kind: "unsupported",
  choice: "vlc",
});
expect(DETACHED_HANDOFF_CAPABILITIES.progressEvents).toBe(false);
```

Assert help text lists all three values and `KNOWN_FLAGS`/`VALUE_FLAGS` both contain `--player`.

- [ ] **Step 2: Run tests and verify the declaration is absent**

```sh
bun run --cwd apps/cli test:file test/unit/main-args.test.ts
bun run --cwd apps/cli test:file test/unit/domain/playback/player-choice.test.ts
bun run --cwd apps/cli test:file test/unit/domain/playback/player-capabilities.test.ts
```

Expected: module/field/flag missing failures.

- [ ] **Step 3: Implement canonical parsing and composition input**

Parse once in `cli-args.ts`, include `--player <auto|mpv|vlc>` in help, and pass the typed choice from `main.ts` into container bootstrap. Do not read `process.argv` or environment variables inside player implementations.

- [ ] **Step 4: Verify parser, domain policy, and typecheck**

```sh
bun run --cwd apps/cli test:file test/unit/main-args.test.ts
bun run --cwd apps/cli test:file test/unit/domain/playback/player-choice.test.ts
bun run --cwd apps/cli test:file test/unit/domain/playback/player-capabilities.test.ts
bun run --cwd apps/cli typecheck
```

- [ ] **Step 5: Commit**

```sh
git add apps/cli/src/domain/playback/player-choice.ts apps/cli/src/domain/playback/player-capabilities.ts apps/cli/test/unit/domain/playback/player-choice.test.ts apps/cli/test/unit/domain/playback/player-capabilities.test.ts apps/cli/src/cli-args.ts apps/cli/test/unit/main-args.test.ts apps/cli/src/main.ts apps/cli/src/container/bootstrap-services.ts apps/cli/src/container/types.ts
git commit -m "feat: add explicit player selection"
```

### Task 4: Qualify streams before detached handoff

**Files:**

- Create: `apps/cli/src/domain/playback/handoff-plan.ts`
- Create: `apps/cli/test/unit/domain/playback/handoff-plan.test.ts`

**Interfaces:**

- Consumes: `StreamInfo`, `DetachedPlayerTarget`, and immutable `PlayerCapabilities` facts from Task 3.
- Produces:

```ts
type HandoffBlocker =
  | "custom-headers-required"
  | "cookies-required"
  | "yt-dlp-required"
  | "deferred-source"
  | "unsupported-scheme"
  | "external-subtitle-unsupported"
  | "local-source-unsupported";

type HandoffPlan =
  | { readonly ok: true; readonly url: string; readonly player: DetachedPlayerTarget }
  | { readonly ok: false; readonly blockers: readonly HandoffBlocker[] };

function createHandoffPlan(input: {
  readonly stream: StreamInfo;
  readonly player: DetachedPlayerTarget;
  readonly capabilities: PlayerCapabilities;
  readonly localSource: boolean;
}): HandoffPlan;
```

- [ ] **Step 1: Write one failing test per acceptance or blocker rule**

Cover direct HTTP and HTTPS acceptance, then independently cover a cookie header, another custom header, `requiresYtdl`, `deferredLocator`, `file:`/`javascript:`/relative URLs, a selected external subtitle, and a local source. Assert blockers are stable, deduplicated, and ordered for deterministic copy.

- [ ] **Step 2: Run and verify the pure module is missing**

```sh
bun run --cwd apps/cli test:file test/unit/domain/playback/handoff-plan.test.ts
```

Expected: import failure before implementation.

- [ ] **Step 3: Implement the minimal pure planner**

Use `new URL(stream.url)` for parsing. Treat header names case-insensitively, classify `cookie` separately, and reject every non-empty header value. Never rewrite URLs or move headers into query parameters.

- [ ] **Step 4: Run the pure tests and architecture boundary test**

```sh
bun run --cwd apps/cli test:file test/unit/domain/playback/handoff-plan.test.ts
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
```

Expected: domain code imports no infrastructure, shell, service, or Ink module.

- [ ] **Step 5: Commit**

```sh
git add apps/cli/src/domain/playback/handoff-plan.ts apps/cli/test/unit/domain/playback/handoff-plan.test.ts
git commit -m "feat: qualify detached playback streams"
```

### Task 5: Build Android intent launch plans and adapter

**Files:**

- Create: `apps/cli/src/infra/player/android-intent-launcher.ts`
- Create: `apps/cli/test/unit/infra/player/android-intent-launcher.test.ts`

**Interfaces:**

- Consumes: `DetachedPlayerTarget` from Task 3; does not declare a second player-target union.
- Produces:

```ts
type AndroidIntentFailure = "intent-launcher-missing" | "player-not-installed" | "launch-rejected";

interface AndroidIntentRuntime {
  which(command: string): string | null;
  spawn(argv: readonly string[]): {
    readonly exited: Promise<number>;
    readonly stdout: ReadableStream<Uint8Array> | null;
    readonly stderr: ReadableStream<Uint8Array> | null;
  };
}

function resolveAndroidIntentCommand(input: {
  readonly target: AndroidPlayerTarget;
  readonly url: string;
  readonly runtime: Pick<AndroidIntentRuntime, "which">;
}):
  | { readonly ok: true; readonly argv: readonly string[]; readonly launcher: string }
  | { readonly ok: false; readonly reason: "intent-launcher-missing" };

function launchAndroidIntent(input: {
  readonly target: DetachedPlayerTarget;
  readonly url: string;
  readonly runtime?: AndroidIntentRuntime;
}): Promise<
  | { readonly ok: true; readonly launcher: string }
  | { readonly ok: false; readonly reason: AndroidIntentFailure; readonly detail?: string }
>;
```

- [ ] **Step 1: Write failing command-plan tests**

Assert:

- launcher precedence is `termux-am`, `am`, then `termux-open-url`;
- chooser uses `ACTION_VIEW`, URL, and `video/*` without a package;
- VLC adds `-p org.videolan.vlc`;
- mpv adds `-p is.xyz.mpv`;
- `termux-open-url` is used only for chooser because it cannot target a package;
- hostile URL text remains one argv element;
- missing launchers return a typed failure;
- diagnostics redact query values.

- [ ] **Step 2: Run and verify the adapter tests fail**

```sh
bun run --cwd apps/cli test:file test/unit/infra/player/android-intent-launcher.test.ts
```

- [ ] **Step 3: Implement launcher discovery, argv construction, and typed execution**

Use injected runtime methods in tests and `Bun.which`/`Bun.spawn` only in the production default. Await the launch command's exit status and bound captured stderr before returning `launch-rejected`.

- [ ] **Step 4: Verify the adapter and lint**

```sh
bun run --cwd apps/cli test:file test/unit/infra/player/android-intent-launcher.test.ts
bun run --cwd apps/cli lint
```

- [ ] **Step 5: Commit**

```sh
git add apps/cli/src/infra/player/android-intent-launcher.ts apps/cli/test/unit/infra/player/android-intent-launcher.test.ts
git commit -m "feat: launch Android external players"
```

### Task 6: Add honest detached playback results

**Files:**

- Modify: `apps/cli/src/domain/types.ts`
- Modify: `apps/cli/src/infra/player/PlayerService.ts`
- Modify: `apps/cli/src/infra/player/PlayerServiceImpl.ts`
- Create: `apps/cli/src/infra/player/handoff-player-service.ts`
- Create: `apps/cli/test/unit/infra/player/handoff-player-service.test.ts`
- Modify: `apps/cli/src/app/playback/policies/playback-result-policy.ts`
- Modify: `apps/cli/test/unit/app/playback-session-controller.test.ts`
- Modify: `apps/cli/test/unit/app/playback/run-mpv-playback-session.test.ts`
- Modify: `apps/cli/test/integration/queue-playback-lifecycle.test.ts`

**Interfaces:**

- Consumes `PlayerCapabilities` and the managed/detached constants from Task 3.
- Extends `PlaybackStatsSource` with `"handoff"`.
- Extends `PlaybackResult` with optional immutable handoff evidence:

```ts
readonly handoff?: {
  readonly accepted: true;
  readonly player: "chooser" | "vlc" | "mpv";
  readonly launcher: string;
};
```

- Produces `isDetachedHandoffResult(result: PlaybackResult): boolean`.
- Produces `HandoffPlayerService implements PlayerService`.
- Adds required `readonly capabilities: PlayerCapabilities` to `PlayerService`; `PlayerServiceImpl` exposes `MANAGED_MPV_CAPABILITIES`, and typed test doubles expose the matching constant explicitly.

- [ ] **Step 1: Write failing capabilities, result, and policy tests**

Assert the adapter advertises detached/no-progress/no-completion capabilities, returns zero progress with `resultSource: "handoff"`, and never emits `playback-started`. Assert `resolvePlaybackResultDecision` returns no fallback, no refresh, no interrupted-progress inference, and pauses autoplay for a handoff.

- [ ] **Step 2: Run and verify the missing behavior fails**

```sh
bun run --cwd apps/cli test:file test/unit/infra/player/handoff-player-service.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback-session-controller.test.ts
```

- [ ] **Step 3: Implement the detached adapter and early policy branch**

The adapter calls `createHandoffPlan`, then the Android launcher. A blocker throws a typed pre-launch error with user-safe copy. A successful launch returns:

```ts
{
  watchedSeconds: 0,
  duration: 0,
  endReason: "unknown",
  resultSource: "handoff",
  handoff: { accepted: true, player, launcher },
}
```

Lifecycle methods are deterministic no-ops because the adapter owns no media process. `playLocal` fails with `local-source-unsupported` rather than forwarding to a remote URL path. Add `capabilities` to the two typed player doubles in `run-mpv-playback-session.test.ts` and `queue-playback-lifecycle.test.ts`; do not weaken the interface to make test fakes compile.

- [ ] **Step 4: Run focused tests and existing player characterization**

```sh
bun run --cwd apps/cli test:file test/unit/infra/player/handoff-player-service.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback-session-controller.test.ts
bun run --cwd apps/cli test:file test/unit/infra/player/PlayerServiceImpl.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback/run-mpv-playback-session.test.ts
bun run --cwd apps/cli test:file test/integration/queue-playback-lifecycle.test.ts
```

- [ ] **Step 5: Commit**

```sh
git add apps/cli/src/domain/types.ts apps/cli/src/infra/player/PlayerService.ts apps/cli/src/infra/player/PlayerServiceImpl.ts apps/cli/src/infra/player/handoff-player-service.ts apps/cli/test/unit/infra/player/handoff-player-service.test.ts apps/cli/src/app/playback/policies/playback-result-policy.ts apps/cli/test/unit/app/playback-session-controller.test.ts apps/cli/test/unit/app/playback/run-mpv-playback-session.test.ts apps/cli/test/integration/queue-playback-lifecycle.test.ts
git commit -m "feat: model detached playback evidence"
```

### Task 7: Route playback, dependency, queue, and shell behavior through capabilities

**Files:**

- Create: `apps/cli/src/app/playback/run-playback-session.ts`
- Create: `apps/cli/test/unit/app/playback/run-playback-session.test.ts`
- Modify: `apps/cli/src/app/playback/PlaybackPhase.ts`
- Modify: `apps/cli/src/app/playback/playback-dependency-gate.ts`
- Modify: `apps/cli/test/unit/app/playback-dependency-gate.test.ts`
- Modify: `apps/cli/src/app/playback/queue-playback-attempt.ts`
- Modify: `apps/cli/test/unit/app/playback/queue-playback-attempt.test.ts`
- Modify: `apps/cli/src/container/bootstrap-services.ts`
- Modify: `apps/cli/test/unit/container/bootstrap-debug-capabilities.test.ts`
- Modify: `apps/cli/src/app-shell/playback-session-key-hints.ts`
- Modify: `apps/cli/test/unit/app-shell/help-scope.test.ts`

**Interfaces:**

- Consumes: player choice/mode, handoff planner/adapter, capabilities, and handoff result from Tasks 3–6.
- Produces: one `runPlaybackSession()` interface used by `PlaybackPhase`.
- Preserves `runMpvPlaybackSession()` as the observed implementation.

- [ ] **Step 1: Write failing routing and evidence tests**

Assert:

- desktop auto/mpv calls the existing observed runner;
- Android chooser/VLC/mpv calls detached `player.play` without presence launch/progress hooks;
- handoff moves the shell to post-play with “opened externally” copy;
- no startup watchdog is armed;
- no progress/history/playback-event write occurs;
- autoplay and near-EOF are disabled;
- queue acknowledgement is not called and the exact claim returns to pending;
- managed-player control hints disappear in detached mode with explanatory copy;
- dependency remediation names Android player apps/intent launcher rather than desktop mpv installation.

- [ ] **Step 2: Run focused tests and verify current mpv-only routing fails**

```sh
bun run --cwd apps/cli test:file test/unit/app/playback/run-playback-session.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback-dependency-gate.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback/queue-playback-attempt.test.ts
bun run --cwd apps/cli test:file test/unit/app-shell/help-scope.test.ts
```

- [ ] **Step 3: Implement composition and the session façade**

In `bootstrap-services.ts`, instantiate `PlayerServiceImpl` only for `managed-mpv`; instantiate `HandoffPlayerService` for Android modes; reject unsupported desktop VLC with typed remediation. Replace the direct `runMpvPlaybackSession` call in `PlaybackPhase` with `runPlaybackSession` and branch before presence/watchdog wiring when observation is detached.

- [ ] **Step 4: Implement queue and post-play honesty**

Use the handoff discriminant before trusted-progress extraction. Restore the exact queue claim through the existing rollback interface and display detached-copy in post-play. Do not create a parallel queue or history path.

- [ ] **Step 5: Run focused and lifecycle integration tests**

```sh
bun run --cwd apps/cli test:file test/unit/app/playback/run-playback-session.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback-dependency-gate.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback/queue-playback-attempt.test.ts
bun run --cwd apps/cli test:file test/unit/app/playback/playback-phase-outer-loop.test.ts
bun run --cwd apps/cli test:file test/integration/queue-playback-lifecycle.test.ts
```

Expected: detached tests pass and every existing observed-mpv queue contract remains green.

- [ ] **Step 6: Commit**

```sh
git add apps/cli/src/app/playback/run-playback-session.ts apps/cli/test/unit/app/playback/run-playback-session.test.ts apps/cli/src/app/playback/PlaybackPhase.ts apps/cli/src/app/playback/playback-dependency-gate.ts apps/cli/test/unit/app/playback-dependency-gate.test.ts apps/cli/src/app/playback/queue-playback-attempt.ts apps/cli/test/unit/app/playback/queue-playback-attempt.test.ts apps/cli/src/container/bootstrap-services.ts apps/cli/test/unit/container/bootstrap-debug-capabilities.test.ts apps/cli/src/app-shell/playback-session-key-hints.ts apps/cli/test/unit/app-shell/help-scope.test.ts
git commit -m "feat: route Android detached playback"
```

### Task 8: Add Android smoke, documentation, and contract conformance

**Files:**

- Create: `apps/cli/test/live/android-terminal-handoff.ts`
- Create: `apps/cli/test/live/android-terminal-handoff-guard.ts`
- Create: `apps/cli/test/unit/live/android-terminal-handoff-guard.test.ts`
- Modify: `apps/cli/package.json`
- Modify: `package.json`
- Modify: `apps/cli/test/unit/architecture/contract-conformance.test.ts`
- Modify: `.docs/architecture.md`
- Modify: `.docs/runtime-boundary-map.md`
- Modify: `.docs/providers.md`
- Modify: `.docs/testing-strategy.md`
- Modify: `.docs/release-reliability-gate.md`
- Modify: `.docs/quickstart.md`
- Modify: `docs/users/cli-reference.mdx`
- Modify: `docs/users/install-and-update.mdx`
- Modify: `docs/users/playback-and-recovery.mdx`
- Modify: `apps/docs/lib/generated-metadata.json`
- Modify: `.plans/mobile-terminal-handoff.md`
- Modify: `.plans/roadmap.md`

**Interfaces:**

- Produces package task `test:live:android-handoff` and a root forwarding command consistent with the existing live-smoke scripts.
- Produces an opt-in script that refuses non-Android execution and requires isolated storage paths.
- Produces contract-conformance coverage proving every capability/flag reader exists.

- [ ] **Step 1: Write failing contract and smoke-guard tests**

Add architecture assertions that `CliArgs.player` reaches container composition, every `PlayerCapabilities` field has a reader, and Android release targets reach installer/npm/updater consumers. Add a pure guard test proving the live smoke refuses non-Android hosts and rejects HOME/XDG roots that resolve to the developer's real profile.

- [ ] **Step 2: Run and verify the contracts fail before docs/smoke wiring**

```sh
bun run --cwd apps/cli test:file test/unit/architecture/contract-conformance.test.ts
bun run --cwd apps/cli test:file test/unit/live/android-terminal-handoff-guard.test.ts
```

- [ ] **Step 3: Implement the opt-in real-device smoke**

The command must require explicit player choice and a known direct test URL from an environment variable; it must not embed or ship a media host. It records binary/version/TTY/SQLite/launcher evidence in a temporary isolated root and never writes to the live Kunai profile.

- [ ] **Step 4: Update current docs and generated CLI material**

Document exact supported/deferred behavior, Termux installation, VLC/mpv choice, header/subtitle limitations, provider qualification, analytics/relay invariants, and separate deterministic/device/provider/player/release gates. Edit the narrative owners directly, then run `bun run --cwd apps/docs generate` so `apps/docs/lib/generated-metadata.json` picks up the canonical `cli-args.ts` help text; do not hand-edit generated metadata.

- [ ] **Step 5: Verify docs and conformance**

```sh
bun run --cwd apps/cli test:file test/unit/architecture/contract-conformance.test.ts
bun run --cwd apps/cli test:file test/unit/live/android-terminal-handoff-guard.test.ts
bun run --cwd apps/docs generate
bun run verify:doc-paths
bun run verify:doc-frontmatter
bun run verify:readme:commands
```

- [ ] **Step 6: Commit**

```sh
git add apps/cli/test/live/android-terminal-handoff.ts apps/cli/test/live/android-terminal-handoff-guard.ts apps/cli/test/unit/live/android-terminal-handoff-guard.test.ts apps/cli/package.json package.json apps/cli/test/unit/architecture/contract-conformance.test.ts .docs/architecture.md .docs/runtime-boundary-map.md .docs/providers.md .docs/testing-strategy.md .docs/release-reliability-gate.md .docs/quickstart.md docs/users/cli-reference.mdx docs/users/install-and-update.mdx docs/users/playback-and-recovery.mdx apps/docs/lib/generated-metadata.json .plans/mobile-terminal-handoff.md .plans/roadmap.md
git commit -m "docs: document Android terminal handoff"
```

### Task 9: Build, measure, verify, and review the complete slice

**Files:**

- Modify only files required by failures attributable to Tasks 1–8.
- Do not fold unrelated cleanup into this task.

**Interfaces:**

- Consumes the completed Android handoff slice.
- Produces deterministic verification evidence and explicitly separated unrun real-device gates.

- [ ] **Step 1: Run focused Android target builds**

```sh
bun run --cwd apps/cli build:binaries --only android-arm64 --only android-x64 --jobs 1 --analyze
file apps/cli/dist/bin/kunai-android-arm64 apps/cli/dist/bin/kunai-android-x64
```

Expected: Bun emits Bionic artifacts and their tar.gz archives/checksums. Do not execute Android binaries on the Linux host.

- [ ] **Step 2: Record binary and archive measurements**

```sh
wc -c apps/cli/dist/bin/kunai-android-arm64 apps/cli/dist/bin/kunai-android-x64
wc -c apps/cli/dist/bin/kunai-android-arm64.tar.gz apps/cli/dist/bin/kunai-android-x64.tar.gz
```

Report runtime binary size separately from compressed archive size; do not infer cold start, memory, or device compatibility from size.

- [ ] **Step 3: Run mandatory repository gates**

```sh
bunx turbo run typecheck --force
bun run lint
bun run fmt
bun run verify:doc-paths
bun run test
bun run build
bun run verify:build-pipeline:pr
git diff --check
```

Read the complete outputs and report skipped PowerShell, Docker, compiled-binary, live-provider, and device tests separately.

- [ ] **Step 4: Perform the seam audit**

Record decisions for:

- declaration to reader: targets, `--player`, capabilities, smoke command;
- reverse state: explicit choice back to auto and queue claim restoration;
- entrypoints: browse, launch search, direct id, anime, palette/hotkeys, post-play, queue, trailer, offline;
- both identity lanes: anime and TMDB;
- every production provider;
- Android, Linux, macOS, and Windows behavior;
- documentation owners.

- [ ] **Step 5: Review the branch against the fixed base**

```sh
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git status --short
```

Invoke the repository code-review workflow against `origin/main`, address every correctness/spec finding with a failing regression test first, and rerun the affected gates.

- [ ] **Step 6: Run or explicitly defer physical Android gates**

If an Android device is attached, execute the opt-in smoke with isolated HOME/XDG values and record player/provider results. If no device is attached, mark Android runtime, VLC, mpv-android, provider, terminal lifecycle, install reliability, cold start, responsiveness, memory, and release approval as unverified blockers; do not relabel the preview generally available.

- [ ] **Step 7: Commit verified review corrections when present**

For each review correction, repeat its owning task's failing-test, minimal-implementation, and focused-verification steps. Stage the exact test and production paths named by that owning task, then commit:

```sh
git commit -m "fix: close Android handoff review findings"
```

Skip this step when review produces no changes; never create an empty commit.

## iOS follow-up gate

iOS is not implemented by this plan. The next approved spike must prove Node x86 inside current iSH on physical iPhone/iPad hardware before any runtime code is retained. If that proof fails, a shell/Python companion is a separate product implementation and requires an explicit exception to the single-entrypoint policy. VLC iOS handoff remains unverified until repeated `vlc://` launches, subtitle behavior, app suspension, and return-to-terminal behavior pass on real devices.
