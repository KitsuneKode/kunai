# Mobile App Host Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce fixture-only Android and iOS artifacts that prove Kunai's runtime-neutral mobile application can perform terminal input, bounded HTTP, atomic JSON state, cancellation, and an honest VLC handoff before any catalog or provider is ported.

**Architecture:** `apps/mobile` owns one portable application interface and one declared `src/entry.ts`. A build-time resolver maps the virtual `mobile:runtime` import to either a Bun/Termux adapter or an a-Shell mini JavaScriptCore adapter, keeping platform APIs out of the application graph. The host proof accepts tester-owned probe and media URLs, records no URLs or playback progress, and reports only operating-system handoff acceptance.

**Tech Stack:** Bun 1.4, TypeScript, Bun test, Turborepo, Bun/Bionic compiled executables, Bun browser/IIFE bundling, a-Shell mini `jsc`, POSIX shell, `curl`, Android `ACTION_VIEW`, VLC.

**Spec:** `.plans/mobile-app-runtime.md`

## Global Constraints

- `apps/mobile` never imports `apps/cli`, and `apps/cli` never imports `apps/mobile`.
- `apps/mobile/src/entry.ts` is the only mobile application entrypoint.
- The portable application and iOS graph import no `bun:*`, `node:*`, Ink, React, native addon, or SQLite package.
- The host proof has no catalog or provider dependency; those ports are added only when a later task consumes them.
- Android uses Bun/Bionic targets `bun-linux-arm64-android` and `bun-linux-x64-android` with no user-installed JavaScript runtime.
- iOS uses foreground a-Shell mini `jsc`; it does not use Node, Python, iSH, `term_`, or runtime npm installation.
- a-Shell command execution uses constant command strings and app-owned files. User URLs, headers, and terminal input are never interpolated into shell source.
- Only absolute HTTP(S) probe and media URLs are accepted. URL query values never enter logs, state, or evidence.
- A handoff result proves only that the OS accepted an open request. It never records playback start, progress, completion, EOF, or provider health.
- Analytics and install IDs are absent.
- Default tests use in-memory adapters and isolated temporary roots; never use `KUNAI_CONFIG_DIR` or the developer's live profile.
- Physical-device evidence is a separate gate. A successful build or simulator run is not an iOS or Android support claim.

## File structure

### Portable application

- `apps/mobile/src/entry.ts` — the only entrypoint; reads the build-selected composition and exits with the application result.
- `apps/mobile/src/application/contracts.ts` — mobile port, result, state, and host-proof command types.
- `apps/mobile/src/application/parse-mobile-args.ts` — strict `--help`, `--version`, and `--host-proof` parsing.
- `apps/mobile/src/application/run-mobile-application.ts` — host-proof workflow and honest state transitions.
- `apps/mobile/src/application/mobile-state.ts` — schema-1 decoding and migration-free defaults.
- `apps/mobile/src/runtime/runtime-module.d.ts` — type contract for the build-resolved `mobile:runtime` module.

### Android host

- `apps/mobile/src/runtime/android/composition.ts` — Bun adapter composition.
- `apps/mobile/src/runtime/android/bun-http-port.ts` — bounded Fetch implementation.
- `apps/mobile/src/runtime/android/bun-state-store.ts` — isolated atomic JSON storage.
- `apps/mobile/src/runtime/android/bun-terminal-port.ts` — line-oriented stdin/stdout.
- `apps/mobile/src/runtime/android/android-player-port.ts` — fixed argv launcher execution.

### iOS host

- `apps/mobile/src/runtime/ashell/ashell-globals.ts` — declared, validated `jsc` host surface.
- `apps/mobile/src/runtime/ashell/composition.ts` — a-Shell adapter composition.
- `apps/mobile/src/runtime/ashell/ashell-terminal-port.ts` — fixed helper plus answer-file bridge.
- `apps/mobile/src/runtime/ashell/ashell-state-store.ts` — atomic `jsc.writeFile`/`jsc.move` state.
- `apps/mobile/src/runtime/ashell/ashell-http-port.ts` — validated curl-config request bridge.
- `apps/mobile/src/runtime/ashell/ashell-player-port.ts` — encoded VLC x-callback handoff through a fixed helper.
- `apps/mobile/scripts/ashell/kunai-mobile-read-line` — stdin plumbing only.
- `apps/mobile/scripts/ashell/kunai-mobile-http` — fixed curl invocation over app-owned files.
- `apps/mobile/scripts/ashell/kunai-mobile-open-vlc` — fixed `openurl` invocation over an app-owned URL file.
- `apps/mobile/scripts/ashell/kunai-mobile` — installed foreground launcher.

### Build and evidence

- `apps/mobile/scripts/build.ts` — build-time runtime resolver, Android compile, iOS IIFE bundle, graph checks, and size manifest.
- `apps/mobile/scripts/build-contract.ts` — pure target and forbidden-input contracts.
- `apps/mobile/test/live/device-host-proof.ts` — evidence validator only; it never launches a device remotely.
- `.docs/mobile-terminal-runtime.md` — preview contract, exact isolated device commands, and support gates.

---

### Task 1: Establish the workspace and cross-app boundary

**Files:**

- Create: `apps/mobile/package.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/src/application/contracts.ts`
- Create: `apps/mobile/test/unit/architecture/mobile-boundary.test.ts`
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `AGENTS.md`
- Modify: `.docs/architecture.md`
- Modify: `apps/cli/test/unit/architecture/boundary-imports.test.ts`

**Interfaces:**

- Produces package `@kunai/mobile`, private and unpublished.
- Produces `MobileHttpPort`, `MobileStateStore`, `MobileTerminalPort`, `MobilePlayerPort`, `MobileEnvironment`, and `MobileExit`.
- Produces repository guards for cross-app imports and iOS-forbidden built-ins.

- [ ] **Step 1: Write the failing boundary tests**

First extend the existing CLI architecture test with the assertion that makes
the new workspace requirement fail before any `apps/mobile` package exists:

```ts
const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  workspaces: { packages: string[] };
};
expect(rootPackage.workspaces.packages).toContain("apps/mobile");
```

Then add `apps/mobile/test/unit/architecture/mobile-boundary.test.ts` with
repository-relative scans that will guard the created package:

```ts
expect(mobilePackage.name).toBe("@kunai/mobile");
expect(mobilePackage.private).toBe(true);
expect(collectImports("apps/mobile/src").filter((edge) => edge.includes("apps/cli"))).toEqual([]);
expect(collectImports("apps/cli/src").filter((edge) => edge.includes("apps/mobile"))).toEqual([]);
```

Extend `ACTIVE_ROOTS` in the existing boundary test and add an iOS-root assertion:

```ts
const IOS_FORBIDDEN_IMPORT = /^(?:bun:|node:|ink(?:\/|$)|react(?:\/|$)|bun:sqlite$)/;

expect(
  collectSourceFiles("apps/mobile/src/runtime/ashell").flatMap((file) =>
    collectImports(file)
      .filter((specifier) => IOS_FORBIDDEN_IMPORT.test(specifier))
      .map((specifier) => `${file} -> ${specifier}`),
  ),
).toEqual([]);
```

- [ ] **Step 2: Run the tests and verify they fail for the missing workspace**

```sh
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
```

Expected: the mobile workspace/package assertion cannot be satisfied because `apps/mobile` does not exist.

- [ ] **Step 3: Create the package and contracts**

Use this package contract:

```json
{
  "name": "@kunai/mobile",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bun run scripts/build.ts",
    "typecheck": "bun tsc --noEmit",
    "lint": "oxlint .",
    "fmt": "oxfmt --write .",
    "fmt:check": "oxfmt --check .",
    "test": "bun test test",
    "test:unit": "bun test test/unit",
    "test:integration": "bun test test/integration"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

Use strict bundler-mode TypeScript with `lib: ["ESNext", "DOM"]`, `target: "ES2020"`, `module: "Preserve"`, `types: ["bun"]`, and includes for `src`, `scripts`, and `test`.

Define the initial consumed contracts exactly as:

```ts
export type MobileHttpRequest = {
  readonly method: "GET";
  readonly url: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
};

export type MobileHttpResponse = {
  readonly status: number;
  readonly bytes: number;
};

export interface MobileHttpPort {
  request(request: MobileHttpRequest): Promise<MobileHttpResponse>;
}

export type MobileState = {
  readonly schemaVersion: 1;
  readonly hostProofRuns: number;
  readonly lastResult?: "cancelled" | "http-ok" | "handoff-accepted" | "failed";
};

export interface MobileStateStore {
  load(): Promise<MobileState>;
  commit(next: MobileState): Promise<void>;
}

export interface MobileTerminalPort {
  render(lines: readonly string[]): Promise<void>;
  choose(input: {
    readonly prompt: string;
    readonly choices: readonly { readonly value: string; readonly label: string }[];
  }): Promise<
    { readonly kind: "selected"; readonly value: string } | { readonly kind: "cancelled" }
  >;
}

export interface MobilePlayerPort {
  handoff(input: {
    readonly player: "vlc";
    readonly url: string;
  }): Promise<
    | { readonly kind: "accepted"; readonly launcher: string }
    | { readonly kind: "rejected"; readonly reason: string }
  >;
}

export type MobileEnvironment = {
  readonly http: MobileHttpPort;
  readonly state: MobileStateStore;
  readonly terminal: MobileTerminalPort;
  readonly player: MobilePlayerPort;
};

export type MobileExit = {
  readonly code: number;
  readonly reason: "completed" | "cancelled" | "handoff" | "invalid-input" | "failed";
};
```

Do not add catalog/provider fields yet; no reader exists in this slice.

- [ ] **Step 4: Register the workspace and explicit entrypoint exception**

Add `apps/mobile` to the root workspace list. Because Task 1 has not created the
entrypoint yet, change the AGENTS rule to state the current enforceable rule:

```text
apps/cli/src/main.ts is the only desktop CLI entrypoint. The apps/mobile
application may add exactly one mobile entrypoint; neither app may import the
other.
```

Make the same desktop/mobile distinction in `.docs/architecture.md` without
changing the documented desktop runtime flow. Task 2 replaces this prospective
wording with the exact `apps/mobile/src/entry.ts` path in both documents when
the file exists.

Run `bun install` so `bun.lock` records the workspace without changing dependency versions.

- [ ] **Step 5: Verify the boundary package**

```sh
bun run --cwd apps/mobile typecheck
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
bun run verify:doc-paths
git diff --check
```

Expected: all pass; the only lockfile change is workspace registration.

- [ ] **Step 6: Commit**

```sh
git add AGENTS.md .docs/architecture.md package.json bun.lock apps/mobile/package.json apps/mobile/tsconfig.json apps/mobile/src/application/contracts.ts apps/mobile/test/unit/architecture/mobile-boundary.test.ts apps/cli/test/unit/architecture/boundary-imports.test.ts
git commit -m "feat(mobile): establish runtime boundaries"
```

### Task 2: Build the runtime-neutral host-proof application

**Files:**

- Create: `apps/mobile/src/application/mobile-state.ts`
- Create: `apps/mobile/src/application/parse-mobile-args.ts`
- Create: `apps/mobile/src/application/run-mobile-application.ts`
- Create: `apps/mobile/src/entry.ts`
- Create: `apps/mobile/src/runtime/runtime-module.d.ts`
- Create: `apps/mobile/test/support/fake-mobile-environment.ts`
- Create: `apps/mobile/test/unit/application/parse-mobile-args.test.ts`
- Create: `apps/mobile/test/unit/application/run-mobile-application.test.ts`

**Interfaces:**

- Consumes: all Task 1 ports.
- Produces `parseMobileArgs(argv)` with help/version/host-proof outcomes.
- Produces `runMobileApplication({ argv, environment, version }): Promise<MobileExit>`.
- Produces virtual runtime module function `createMobileEnvironment(): MobileEnvironment`.

- [ ] **Step 1: Write failing parser tests**

```ts
expect(parseMobileArgs(["--help"])).toEqual({ kind: "help" });
expect(parseMobileArgs(["--version"])).toEqual({ kind: "version" });
expect(
  parseMobileArgs([
    "--host-proof",
    "--probe-url",
    "https://probe.example/status?token=secret",
    "--media-url",
    "https://media.example/video.m3u8?token=secret",
  ]),
).toEqual({
  kind: "host-proof",
  probeUrl: "https://probe.example/status?token=secret",
  mediaUrl: "https://media.example/video.m3u8?token=secret",
});
expect(() => parseMobileArgs(["--host-proof", "--probe-url", "file:///tmp/x"])).toThrow(
  "absolute HTTP(S)",
);
```

- [ ] **Step 2: Write failing application tests**

Cover these exact observations through the fake environment:

```ts
expect(cancelled).toEqual({ code: 0, reason: "cancelled" });
expect(fake.httpRequests).toHaveLength(0);
expect(fake.playerRequests).toHaveLength(0);

expect(success).toEqual({ code: 0, reason: "handoff" });
expect(fake.httpRequests).toEqual([
  { method: "GET", url: probeUrl, timeoutMs: 8_000, maxBytes: 65_536 },
]);
expect(fake.playerRequests).toEqual([{ player: "vlc", url: mediaUrl }]);
expect(fake.committedStates.at(-1)).toEqual({
  schemaVersion: 1,
  hostProofRuns: 1,
  lastResult: "handoff-accepted",
});
expect(JSON.stringify(fake.committedStates)).not.toContain("token=secret");
```

Also prove non-2xx HTTP, oversized body, rejected handoff, invalid state, EOF, and Ctrl+C-shaped cancellation return typed exits and never print either raw URL.

- [ ] **Step 3: Run focused tests and confirm the application is absent**

```sh
bun run --cwd apps/mobile test:unit
```

Expected: imports for parser/application/fakes fail.

- [ ] **Step 4: Implement strict parsing and state decoding**

`parseMobileArgs` accepts only these complete forms:

```ts
export type MobileCommand =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "host-proof"; readonly probeUrl: string; readonly mediaUrl: string };
```

Reject duplicate flags, missing values, unknown flags, fragments, credentials in URLs, and protocols other than HTTP/HTTPS. `decodeMobileState` returns the schema-1 default only for a missing file; malformed or future-version data is a visible failure.

- [ ] **Step 5: Implement the single workflow**

The application sequence is fixed:

```ts
await terminal.render(["Kunai mobile host proof", "No playback progress will be recorded."]);
const decision = await terminal.choose({
  prompt: "Continue?",
  choices: [
    { value: "continue", label: "Run proof" },
    { value: "cancel", label: "Cancel" },
  ],
});
const nextRunCount = current.hostProofRuns + 1;
if (decision.kind === "cancelled" || decision.value === "cancel") {
  await state.commit({ ...current, hostProofRuns: nextRunCount, lastResult: "cancelled" });
  return { code: 0, reason: "cancelled" };
}
const response = await http.request({
  method: "GET",
  url: probeUrl,
  timeoutMs: 8_000,
  maxBytes: 65_536,
});
if (response.status < 200 || response.status >= 300)
  throw new Error(`Probe failed with HTTP ${response.status}`);
await state.commit({ ...current, hostProofRuns: nextRunCount, lastResult: "http-ok" });
const handoff = await player.handoff({ player: "vlc", url: mediaUrl });
if (handoff.kind === "rejected") throw new Error(`VLC handoff rejected: ${handoff.reason}`);
await state.commit({ ...current, hostProofRuns: nextRunCount, lastResult: "handoff-accepted" });
return { code: 0, reason: "handoff" };
```

On HTTP or handoff failure, commit the same `nextRunCount` with
`lastResult: "failed"` when the state store is usable. Invalid/corrupt state is
reported without attempting a commit. Error presentation is fixed copy and
never includes exception messages that may contain URLs.

- [ ] **Step 6: Add the only entrypoint**

Declare the virtual module:

```ts
declare module "mobile:runtime" {
  import type { MobileEnvironment } from "../application/contracts";
  export function createMobileEnvironment(): MobileEnvironment;
  export function mobileArgv(): readonly string[];
  export function mobileVersion(): string;
  export function exitMobile(code: number): void;
}
```

`entry.ts` imports `createMobileEnvironment`, `mobileArgv`, `mobileVersion`, and
`exitMobile` from `mobile:runtime`, calls `runMobileApplication`, and passes only
`result.code` to `exitMobile`. The application receives the version as explicit
input so `--version` has a real reader. The entrypoint contains no platform
detection.

- [ ] **Step 7: Verify and commit**

```sh
bun run --cwd apps/mobile test:unit
bun run --cwd apps/mobile typecheck
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
git diff --check
git add apps/mobile/src apps/mobile/test
git commit -m "feat(mobile): add host proof application core"
```

### Task 3: Add the Android Bun host and shared intent plan

**Files:**

- Create: `packages/core/src/android-intent-plan.ts`
- Create: `packages/core/test/android-intent-plan.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/cli/src/infra/player/android-intent-launcher.ts`
- Modify: `apps/cli/test/unit/infra/player/android-intent-launcher.test.ts`
- Modify: `apps/mobile/package.json`
- Modify: `bun.lock`
- Create: `apps/mobile/src/runtime/android/bun-http-port.ts`
- Create: `apps/mobile/src/runtime/android/bun-state-store.ts`
- Create: `apps/mobile/src/runtime/android/bun-terminal-port.ts`
- Create: `apps/mobile/src/runtime/android/android-player-port.ts`
- Create: `apps/mobile/src/runtime/android/composition.ts`
- Create: `apps/mobile/test/unit/runtime/android/*.test.ts`

**Interfaces:**

- Produces pure `resolveAndroidIntentPlan({ target, url, launchers })` in `@kunai/core`.
- Preserves the existing CLI `resolveAndroidIntentCommand` and `launchAndroidIntent` public behavior.
- Produces Android implementations of all five mobile ports.

- [ ] **Step 1: Move the pure intent expectations to core first**

Write core tests for launcher order, VLC package pinning, chooser fallback, metacharacter-rich URL opacity, and missing launcher. Use the shared result:

```ts
type AndroidIntentPlan =
  | {
      readonly ok: true;
      readonly launcher: "termux-am" | "am" | "termux-open" | "termux-open-url";
      readonly argv: readonly string[];
    }
  | { readonly ok: false; readonly reason: "intent-launcher-missing" };
```

Run:

```sh
bun run --cwd packages/core test
```

Expected: missing module/export failure.

- [ ] **Step 2: Extract only the pure planner**

The core function accepts resolved launcher paths rather than calling `Bun.which`:

```ts
resolveAndroidIntentPlan({
  target: "vlc",
  url,
  launchers: { termuxAm: "/usr/bin/termux-am", am: "/system/bin/am" },
});
```

Keep process discovery, spawn, output reading, and Android error classification in adapters. Change the CLI wrapper to collect launcher paths and delegate to core, then rerun its existing tests unchanged.

Add `@kunai/core: "workspace:*"` as an `apps/mobile` runtime dependency and
`@types/node: "catalog:"` as a development-only dependency for the Android
filesystem adapter. Do not add Node imports to portable or a-Shell modules.
Refresh `bun.lock` with `bun install`.

- [ ] **Step 3: Write failing Android adapter tests**

Use injected fetch, filesystem, line-I/O, `which`, and spawn functions. Assert:

```ts
expect(httpAbortAfterMs).toBe(8_000);
expect(() => decodeResponse(over65KiB)).toThrow("response too large");
expect(spawnedArgv.filter((value) => value === mediaUrl)).toHaveLength(1);
expect(stateWrites.map((write) => write.path)).toEqual([tempPath]);
expect(stateRenames).toContainEqual([tempPath, finalPath]);
expect(rendered).not.toContain(mediaUrl);
```

The state test must simulate a failed rename and prove the previous valid file remains readable.

- [ ] **Step 4: Implement Android adapters**

- HTTP uses `fetch` plus `AbortController`, a cancellable `setTimeout`, `redirect: "follow"`, and streamed byte counting before UTF-8 decode.
- State uses `Bun.file`/`Bun.write` for content and an injected atomic rename operation. The default Android adapter may use Node rename semantics because it is excluded from the iOS graph.
- Terminal uses a buffered `Bun.stdin.stream()` reader and `Bun.write(Bun.stdout, text)`. It accepts a number or exact choice value; EOF and an adapter-owned SIGINT/abort path return `{ kind: "cancelled" }` without leaving raw terminal mode behind.
- Player discovers `termux-am`, `am`, `termux-open`, and `termux-open-url`, delegates argv construction to `@kunai/core`, and calls `Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" })`.
- Composition stores state under the Termux-owned app data directory derived from `HOME`; it does not read desktop Kunai storage.

- [ ] **Step 5: Verify desktop preservation and Android behavior**

```sh
bun run --cwd packages/core test
bun run --cwd apps/mobile test:unit
bun run --cwd apps/cli test:file test/unit/infra/player/android-intent-launcher.test.ts
bun run --cwd apps/cli test:file test/unit/infra/player/handoff-player-service.test.ts
bun run --cwd apps/mobile typecheck
```

Expected: all pass and the CLI test assertions require no copy changes.

- [ ] **Step 6: Commit**

```sh
git add packages/core apps/cli/src/infra/player/android-intent-launcher.ts apps/cli/test/unit/infra/player/android-intent-launcher.test.ts apps/mobile/src/runtime/android apps/mobile/test/unit/runtime/android
git add apps/mobile/package.json bun.lock
git commit -m "feat(mobile): add Android host adapters"
```

### Task 4: Prove the a-Shell terminal and state bridge

**Files:**

- Create: `apps/mobile/src/runtime/ashell/ashell-globals.ts`
- Create: `apps/mobile/src/runtime/ashell/ashell-command-bridge.ts`
- Create: `apps/mobile/src/runtime/ashell/ashell-terminal-port.ts`
- Create: `apps/mobile/src/runtime/ashell/ashell-state-store.ts`
- Create: `apps/mobile/scripts/ashell/kunai-mobile-read-line`
- Create: `apps/mobile/test/unit/runtime/ashell/ashell-command-bridge.test.ts`
- Create: `apps/mobile/test/unit/runtime/ashell/ashell-terminal-port.test.ts`
- Create: `apps/mobile/test/unit/runtime/ashell/ashell-state-store.test.ts`

**Interfaces:**

- Produces the only declaration of the a-Shell `jsc` host object.
- Produces `runFixedHelper(name)` restricted to a literal allowlist.
- Produces iOS terminal and state ports without Node/Bun imports.

- [ ] **Step 1: Write failing host-surface and helper tests**

Use a fake `jsc` object and assert:

```ts
expect(runFixedHelper("read-line")).toBe(0);
expect(systemCommands).toEqual(["./kunai-mobile-read-line"]);
expect(() => runFixedHelper("../../bin/sh" as never)).toThrow("Unsupported helper");
expect(systemCommands.join(" ")).not.toContain(answer);
```

Terminal cases cover `1`, `continue`, invalid input then retry, `0`, empty input, helper non-zero, and missing answer file. State cases cover missing state, valid state, malformed JSON, future schema, temp write failure, move failure, and preservation of the prior state.

- [ ] **Step 2: Run the tests and verify the bridge is absent**

```sh
bun run --cwd apps/mobile test:unit test/unit/runtime/ashell
```

Expected: missing adapter imports.

- [ ] **Step 3: Implement the typed a-Shell host and constant helper bridge**

Declare only upstream-documented calls:

```ts
export interface AShellJsc {
  readFile(path: string): string;
  writeFile(path: string, content: string): number;
  isFile(path: string): boolean;
  makeFolder(path: string): number;
  deleteFile(path: string): number;
  move(from: string, to: string): number;
  system(command: string): number;
}
```

Validate `globalThis.jsc` at composition time. The helper map is data-free:

```ts
const HELPER_COMMANDS = {
  "read-line": "./kunai-mobile-read-line",
  http: "./kunai-mobile-http",
  "open-vlc": "./kunai-mobile-open-vlc",
} as const;
```

- [ ] **Step 4: Implement the read-line helper and terminal adapter**

The complete helper behavior is:

```sh
#!/bin/sh
set -eu
umask 077
answer_file=".runtime/terminal-answer"
trap 'rm -f "$answer_file.tmp"' EXIT HUP INT TERM
IFS= read -r answer || exit 130
printf '%s\n' "$answer" >"$answer_file.tmp"
mv "$answer_file.tmp" "$answer_file"
```

The TypeScript adapter renders the numbered choices, deletes any stale answer file, runs the fixed helper, reads the answer file, deletes it, and performs all validation itself. It never calls `term_` or creates shell source.

- [ ] **Step 5: Implement atomic a-Shell state**

Write JSON to `.runtime/mobile-state.json.tmp`, validate by reading/decoding it, delete the old `.runtime/mobile-state.previous`, move the current file to `.previous` when present, then move temp to current. If final activation fails, move `.previous` back. No URL appears in the state type.

- [ ] **Step 6: Verify and commit**

```sh
bun run --cwd apps/mobile test:unit test/unit/runtime/ashell
bun run --cwd apps/mobile typecheck
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
git diff --check
git add apps/mobile/src/runtime/ashell apps/mobile/scripts/ashell/kunai-mobile-read-line apps/mobile/test/unit/runtime/ashell
git commit -m "feat(mobile): add a-Shell terminal bridge"
```

### Task 5: Add bounded a-Shell HTTP and official VLC handoff

**Files:**

- Create: `apps/mobile/src/runtime/ashell/curl-config.ts`
- Create: `apps/mobile/src/runtime/ashell/ashell-http-port.ts`
- Create: `apps/mobile/src/runtime/ashell/vlc-url.ts`
- Create: `apps/mobile/src/runtime/ashell/ashell-player-port.ts`
- Create: `apps/mobile/src/runtime/ashell/composition.ts`
- Create: `apps/mobile/scripts/ashell/kunai-mobile-http`
- Create: `apps/mobile/scripts/ashell/kunai-mobile-open-vlc`
- Create: `apps/mobile/test/unit/runtime/ashell/curl-config.test.ts`
- Create: `apps/mobile/test/unit/runtime/ashell/ashell-http-port.test.ts`
- Create: `apps/mobile/test/unit/runtime/ashell/ashell-player-port.test.ts`

**Interfaces:**

- Produces `encodeCurlConfig(request)` with no shell interpolation.
- Produces `toVlcXCallbackUrl(mediaUrl)` using VLC's `vlc-x-callback://x-callback-url/stream?url=` contract.
- Completes the iOS `MobileEnvironment`.

- [ ] **Step 1: Write failing curl security tests**

Cover quotes, backslashes, spaces, `&`, `$()`, semicolons, query secrets, CR/LF/NUL rejection, non-HTTP schemes, redirect limit, timeout, and response cap. Required assertions:

```ts
expect(systemCommands).toEqual(["./kunai-mobile-http"]);
expect(systemCommands[0]).not.toContain(request.url);
expect(persistedDiagnostics).not.toContain("secret");
expect(() => encodeCurlConfig({ ...request, url: "https://x/\r\noutput=/tmp/pwn" })).toThrow();
```

- [ ] **Step 2: Write failing VLC scheme tests**

```ts
expect(toVlcXCallbackUrl("https://media.example/a b.m3u8?token=a&x=b")).toBe(
  "vlc-x-callback://x-callback-url/stream?url=https%3A%2F%2Fmedia.example%2Fa%20b.m3u8%3Ftoken%3Da%26x%3Db",
);
expect(() => toVlcXCallbackUrl("file:///private/video.mp4")).toThrow("HTTP(S)");
expect(systemCommands).toEqual(["./kunai-mobile-open-vlc"]);
```

- [ ] **Step 3: Implement curl config and fixed helper**

The helper invokes only fixed files:

```sh
#!/bin/sh
set -eu
umask 077
trap 'rm -f .runtime/http-body.tmp .runtime/http-meta.tmp' EXIT HUP INT TERM
curl --config .runtime/curl.conf \
  --proto '=http,https' --proto-redir '=http,https' \
  --max-redirs 3 --silent --show-error \
  --output .runtime/http-body.tmp \
  --write-out '%{http_code}\n%{size_download}\n' >.runtime/http-meta.tmp
mv .runtime/http-body.tmp .runtime/http-body
mv .runtime/http-meta.tmp .runtime/http-meta
```

The TypeScript adapter writes a curl config containing URL, `max-time`, and `max-filesize`, runs the constant helper, parses the two-line metadata, rejects over-limit responses before returning, and removes request/response files in a `finally` path. Curl error text is mapped to fixed categories and is never surfaced raw.

- [ ] **Step 4: Implement VLC x-callback and helper**

The TypeScript adapter validates the media URL, percent-encodes the entire URL with `encodeURIComponent`, writes `.runtime/player-url`, and runs the fixed helper:

```sh
#!/bin/sh
set -eu
player_url=$(cat .runtime/player-url)
case "$player_url" in
  vlc-x-callback://x-callback-url/stream\?url=*) ;;
  *) exit 64 ;;
esac
openurl "$player_url"
```

Return `{ kind: "accepted", launcher: "openurl" }` only for exit 0. This remains detached evidence; do not add callbacks that mark playback successful.

`composition.ts` reads arguments only from a-Shell's documented
`globalThis.process.argv` host value, using a local structural type rather than
Node declarations. No other `process` property is read. `exitMobile(0)` is a
no-op; a non-zero code throws one fixed redacted error so `jsc` returns failure.
The player adapter deletes `.runtime/player-url` in `finally` after the fixed
helper returns.

- [ ] **Step 5: Compose and verify iOS**

```sh
bun run --cwd apps/mobile test:unit test/unit/runtime/ashell
bun run --cwd apps/mobile typecheck
bun run --cwd apps/cli test:file test/unit/architecture/boundary-imports.test.ts
git diff --check
git add apps/mobile/src/runtime/ashell apps/mobile/scripts/ashell apps/mobile/test/unit/runtime/ashell
git commit -m "feat(mobile): add a-Shell HTTP and VLC adapters"
```

### Task 6: Build, scan, and measure both artifacts

**Files:**

- Create: `apps/mobile/scripts/build-contract.ts`
- Create: `apps/mobile/scripts/build.ts`
- Create: `apps/mobile/scripts/ashell/kunai-mobile`
- Create: `apps/mobile/test/unit/scripts/build-contract.test.ts`
- Create: `apps/mobile/test/integration/build-artifacts.test.ts`
- Modify: `turbo.json`

**Interfaces:**

- Produces `dist/kunai-mobile-android-arm64` and `dist/kunai-mobile-android-x64`.
- Produces `dist/ios/kunai-mobile-ios.js` plus four shell helpers.
- Produces `dist/mobile-build-meta.json` with SHA-256 and measured byte sizes.
- Produces a build plugin resolving only `mobile:runtime` to a selected composition.

- [ ] **Step 1: Write failing build-contract tests**

Assert exact target rows and forbidden graph markers:

```ts
expect(MOBILE_TARGETS.map((target) => target.id)).toEqual([
  "android-arm64",
  "android-x64",
  "ios-ashell",
]);
expect(resolveRuntimeModule("ios-ashell")).toEndWith("src/runtime/ashell/composition.ts");
expect(findForbiddenIosInputs(metafile)).toEqual([]);
```

Forbidden iOS markers include `node:`, `bun:`, `/runtime/android/`, Ink, React, SQLite, `.archive/legacy`, `.reference/experiments`, test paths, and planning paths.

- [ ] **Step 2: Implement the build-time resolver**

Use one entrypoint and one exact virtual import:

```ts
function mobileRuntimePlugin(runtimePath: string): BunPlugin {
  return {
    name: "kunai-mobile-runtime",
    setup(build) {
      build.onResolve({ filter: /^mobile:runtime$/ }, () => ({ path: runtimePath }));
    },
  };
}
```

Android builds use `target: "bun"`, `packages: "bundle"`, `env: "disable"`, `metafile: true`, `minify: true`, and compile targets from the global constraints. iOS uses `target: "browser"`, `format: "iife"`, `splitting: false`, `packages: "bundle"`, `env: "disable"`, `metafile: true`, and no sourcemap. Both consume only `src/entry.ts`.

The build script reads the repository release version at build time and defines
`__KUNAI_MOBILE_VERSION__` for both runtime compositions. Each composition's
`mobileVersion()` returns that value; runtime source never imports an app's
`package.json`.

- [ ] **Step 3: Add artifact and syntax guards**

After the iOS build:

- reject forbidden metafile inputs;
- enforce that source-level `process` use occurs only in the audited a-Shell
  `mobileArgv()` adapter;
- scan emitted text for unresolved `import(`, `require(`, `process.env`,
  `process.cwd`, `process.exit`, `process.versions`, `Buffer`, `Bun.`, `node:`,
  and `bun:` tokens;
- run the bundle under a fake JSC-global harness in Bun;
- copy shell helpers with mode `0755` into `dist/ios`;
- hash each output and write actual raw/gzip byte sizes without a fabricated ceiling.

The installed `kunai-mobile` launcher changes to its own directory and runs:

```sh
exec jsc ./kunai-mobile-ios.js "$@"
```

- [ ] **Step 4: Run real cross-builds**

```sh
bun run --cwd apps/mobile build
bun run --cwd apps/mobile test:integration
file apps/mobile/dist/kunai-mobile-android-arm64
file apps/mobile/dist/kunai-mobile-android-x64
sha256sum apps/mobile/dist/kunai-mobile-android-* apps/mobile/dist/ios/*
```

Expected: both Android outputs are ELF files for the requested architectures,
the recorded compile targets are Bionic, the iOS output is one IIFE script,
every helper is present, hashes match build metadata, and the bundle scan
passes. Only a Termux device run proves the Android loader contract.

- [ ] **Step 5: Verify Turbo and commit**

```sh
bun run typecheck -- --force
bun run lint
bun run fmt
bun run test -- --force --concurrency=1
bun run build
git diff --check
git status --short
```

Expected: deterministic gates pass; only intended tracked changes and ignored `apps/mobile/dist` outputs exist.

```sh
git add apps/mobile/scripts apps/mobile/test/unit/scripts apps/mobile/test/integration turbo.json
git commit -m "build(mobile): produce Android and iOS host proofs"
```

### Task 7: Add physical-device evidence without claiming support

**Files:**

- Create: `apps/mobile/test/live/device-host-proof.ts`
- Create: `apps/mobile/test/unit/live/device-host-proof.test.ts`
- Create: `.docs/mobile-terminal-runtime.md`
- Modify: `.docs/feature-map.md`
- Modify: `.docs/runtime-boundary-map.md`
- Modify: `.docs/testing-strategy.md`
- Modify: `.plans/roadmap.md`
- Modify: `package.json`
- Modify: `apps/mobile/package.json`

**Interfaces:**

- Produces `validateMobileDeviceEvidence(value)` for redacted evidence documents.
- Produces opt-in `test:live:mobile-host-proof` validation.
- Does not mark either platform supported; that requires attached physical evidence.

- [ ] **Step 1: Write failing evidence-schema tests**

The evidence shape is:

```ts
type MobileDeviceEvidence = {
  readonly schemaVersion: 1;
  readonly platform: "android" | "ios";
  readonly osVersion: string;
  readonly terminal: "termux" | "a-shell-mini";
  readonly architecture: "arm64" | "x64";
  readonly player: "vlc";
  readonly artifactSha256: string;
  readonly terminalInput: "passed" | "failed";
  readonly http: "passed" | "failed";
  readonly stateRecovery: "passed" | "failed";
  readonly cancellation: "passed" | "failed";
  readonly handoffAccepted: boolean;
  readonly playbackBegan: boolean;
  readonly recordedAt: string;
};
```

Reject unknown fields, URL-shaped values, query strings, authorization/cookie keys, invalid hashes, future schemas, and unsupported terminal/platform pairs.

- [ ] **Step 2: Implement validator and opt-in command**

The live command reads an explicitly supplied evidence JSON path, validates it, prints a redacted matrix row, and exits non-zero for any required `failed`/`false` value. It never controls a device, opens VLC, or reads the developer profile.

- [ ] **Step 3: Document exact physical procedures**

Document separate preview instructions:

- Android ARM64 Termux: copy the checksummed artifact into Termux-owned storage, use a fresh temporary mobile state root, supply tester-owned HTTPS probe/media URLs, test VLC, test Ctrl+C, corrupt the copied state and prove recovery, then export redacted evidence.
- iPhone a-Shell mini: install the five iOS files in a fresh app-owned directory, run `./kunai-mobile --host-proof ...` in the foreground, prove the fixed read-line bridge, HTTP, state recovery, Ctrl+C, `openurl` to VLC, and actual playback start, then export redacted evidence.
- Android x64: emulator/device startup and intent acceptance only unless a physical x64 device exists.

State plainly that no platform is supported until the physical rows pass and are reviewed.

- [ ] **Step 4: Run documentation and full deterministic gates**

```sh
bun run --cwd apps/mobile test:unit test/unit/live/device-host-proof.test.ts
bun run verify:doc-paths
bun run verify:doc-frontmatter
bun run typecheck -- --force
bun run lint
bun run fmt
bun run test -- --force --concurrency=1
bun run build
git diff --check
```

Expected: all deterministic gates pass. The final report still lists physical Android and iPhone qualification as pending unless real evidence files were supplied and reviewed.

- [ ] **Step 5: Commit**

```sh
git add apps/mobile/test/live apps/mobile/test/unit/live apps/mobile/package.json package.json .docs/mobile-terminal-runtime.md .docs/feature-map.md .docs/runtime-boundary-map.md .docs/testing-strategy.md .plans/roadmap.md
git commit -m "docs(mobile): define physical host proof gate"
```

## Completion report

Report these separately:

1. deterministic unit/integration gates;
2. Android ARM64/x64 artifact build and host-side inspection;
3. iOS bundle graph/syntax/harness checks;
4. physical Android Termux + VLC evidence;
5. physical iPhone a-Shell mini + VLC evidence;
6. remaining provider, catalog, distribution, installer, and publishing work.

Do not describe the host proof as feature parity. Its successful output authorizes the next provider-audit and catalog-extraction plans; it does not implement them.
