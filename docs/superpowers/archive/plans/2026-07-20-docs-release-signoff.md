# Documentation and Release Signoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile every public release surface, prove the compiled binary through deterministic core-loop smokes, collect current provider evidence, and stop the release workflow at an explicit protected publication gate.

**Architecture:** Runtime registries remain authoritative. Public docs consume generated CLI/status/shortcut metadata. Deterministic evidence is tied to one candidate SHA/version; volatile provider evidence is separate and time-bounded. Publication jobs consume preserved candidate artifacts and wait for protected approval.

**Tech Stack:** Bun, TypeScript, Next.js/Fumadocs, Docker, PTY/fake mpv/provider harnesses, GitHub Actions, GitHub CLI.

## Global Constraints

- Execute only after runtime Slices 1–6 are merged and green.
- Linux supported; macOS/Windows beta; Windows ARM64 experimental.
- Protocol registration Linux-only; offline/download beta.
- Never document a behavior before its producing tests pass.
- One SHA/version owns package, binaries, metadata, deterministic smokes, and evidence.
- Publishing/tagging/promotion is not part of implementation execution.
- Never track `docs/installer-reference/claude-code/`.

---

### Task 1: Add a failing public-truth contract

**Files:**

- Create: `apps/docs/test/release-doc-contract.test.ts`
- Modify/create docs install-command and fingerprint helpers as needed

- [ ] **Step 1: Encode current 0.3.0 truth**

The test reads public files and asserts:

- install hierarchy: native, Bun, npm, source;
- quick start: install, `kunai --version`, mpv check, setup, first search;
- `kunai upgrade` primary update;
- binary does not require Bun; npm does;
- Linux-only protocol registration;
- Linux supported, macOS/Windows beta, Windows ARM64 experimental;
- Unix socket + Windows named-pipe Discord IPC;
- half-block poster fallback, chafa optional;
- help contains doctor/rollback lifecycle commands;
- 0.2.6 is not latest/published;
- no tracked installer-reference source.

- [ ] **Step 2: Run and verify failure**

```bash
bun run --cwd apps/docs test -- release-doc-contract.test.ts
```

Expected: stale public claims fail.

- [ ] **Step 3: Commit the contract only**

```bash
git add apps/docs/test/release-doc-contract.test.ts \
  apps/docs/lib/install-commands.ts apps/docs/lib/metadata-fingerprints.ts
git commit -m "test(docs): lock the 0.3.0 public truth contract"
```

### Task 2: Reconcile README, npm README, help, status, and first-run docs

**Files:**

- Modify: `README.md`
- Modify: `apps/cli/README.md`
- Modify: `apps/cli/src/cli-args.ts`
- Modify: `apps/cli/test/unit/main-args.test.ts`
- Modify: docs quick-start/getting-started/CLI/feature files
- Modify: `docs/feature-status.yaml`
- Regenerate: `apps/docs/lib/generated-metadata.json`

- [ ] **Step 1: Replace quick start with exact flow**

```sh
curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
kunai --version
mpv --version
kunai --setup
kunai -S "Dune"
```

Explain result selection, episode selection, provider resolution, and committed mpv startup; missing mpv leaves setup/browsing available.

- [ ] **Step 2: Correct runtime claims**

Use `Tab`, `Shift+F`, `/up-next`, `/downloads`, `/library`, `kunai upgrade`, and ownership-aware uninstall. Correct Discord IPC and poster dependencies. Source is contributor-oriented.

- [ ] **Step 3: Correct npm channel page**

State Bun runtime requirement, bundled postinstall ownership, npm update/uninstall, and doctor PATH diagnosis.

- [ ] **Step 4: Expand maintenance help**

Include install, upgrade/check, rollback/list/to, doctor/JSON, uninstall/purge. Protocol description says Linux-only.

- [ ] **Step 5: Generate and run contracts**

```bash
bun run --cwd apps/cli test:file -- test/unit/main-args.test.ts
bun run --cwd apps/docs generate
bun run --cwd apps/docs test -- release-doc-contract.test.ts drift.test.ts
bun run --cwd apps/docs scripts/check-codegen-freshness.ts
```

- [ ] **Step 6: Commit**

Stage the exact edited docs/runtime help/status/generated metadata paths and commit:

```bash
git commit -m "docs: reconcile the 0.3.0 public command surface"
```

### Task 3: Generate a deliberately reduced stable shortcut reference

**Files:**

- Modify: `apps/cli/src/app-shell/keybindings.ts`
- Modify keybinding tests
- Modify docs metadata generator/types/fingerprints
- Create: `apps/docs/components/reference/shortcut-table.tsx`
- Modify: `apps/docs/mdx-components.tsx`
- Modify: `docs/users/commands-and-shortcuts.mdx`
- Modify: `README.md`
- Reconcile: `.docs/keybindings.md`

**Interfaces:**

```ts
export interface PublicShortcutMetadata {
  readonly id: string;
  readonly scope: KeyScope;
  readonly group: string;
  readonly keys: string;
  readonly label: string;
  readonly tier: "core" | "surface";
  readonly order: number;
}
```

- [ ] **Step 1: Add registry invariants**

Every public binding is non-helpOnly, unique by `(scope, chord)`, and has explicit order/tier. Test `Tab` browse mode, `Shift+F` public/bare f absent, and one playback `m` meaning.

- [ ] **Step 2: Add generator output**

`publicShortcutMetadata()` feeds generated docs metadata. MDX uses `<ShortcutTable />`; README contains only core shortcuts and links to generated reference/in-app `?`.

- [ ] **Step 3: Run**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/app-shell/keybindings.test.ts \
  test/unit/app-shell/keybindings-collision.test.ts \
  test/unit/app-shell/keybinding-runtime.test.ts \
  test/unit/app-shell/help-overlay.test.tsx
bun run --cwd apps/docs generate
bun run --cwd apps/docs test
bun run --cwd apps/docs scripts/check-codegen-freshness.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: generate stable shortcuts from the keybinding registry"
```

Stage only registry/tests/generator/generated component/MDX/README/keybinding doc paths.

### Task 4: Add support matrix and installer troubleshooting

**Files:**

- Modify install/platform/troubleshooting/support/provider/share/diagnostics docs
- Modify `README.md`, `apps/cli/README.md`, `PACKAGING.md`

- [ ] **Step 1: Add exact support matrix**

Document four Linux targets supported; macOS x64/arm64 beta; Windows x64 beta; Windows ARM64 experimental; WSL uses Linux environment; BSD unsupported binary.

- [ ] **Step 2: Add Alpine and WSL guidance**

```sh
apk add mpv yt-dlp ffmpeg
curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
kunai --version
kunai --setup
```

Explicitly separate Windows-native and WSL PATH/mpv/data environments.

- [ ] **Step 3: Add installer troubleshooting**

Cover `command -v -a kunai`, `Get-Command kunai -All`, doctor text/JSON, ownership mismatch, checksum/404, rollback, uninstall by owner, unsigned binaries, and PATH shadowing.

- [ ] **Step 4: Add YouTube cookie safety**

Document `cookiesFromBrowser` and absolute `cookiesFile`; never paste contents; review redacted bundles; no DRM bypass claim.

- [ ] **Step 5: Run and commit**

```bash
bun run --cwd apps/docs test
bun run --cwd apps/docs build:app
bun run --cwd apps/docs scripts/check-codegen-freshness.ts
git commit -m "docs: add installer troubleshooting and the 0.3.0 support matrix"
```

### Task 5: Validate exact README commands

**Files:**

- Create: `apps/cli/test/integration/readme-commands.test.ts`
- Create: `apps/cli/test/integration/helpers/readme-command-harness.ts`
- Create: `scripts/verify-readme-commands.ts`
- Modify installer Docker harness, package scripts, CI

**Interfaces:**

```ts
export function extractReadmeQuickStart(readme: string): readonly string[];
export interface ReadmeCommandVerification {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly commitSha: string;
  readonly mode: "fixture-assets" | "published-assets";
  readonly commands: readonly {
    readonly id: string;
    readonly command: string;
    readonly exitCode: number;
    readonly passed: boolean;
  }[];
}
```

- [ ] **Step 1: Add extraction tests**

Parse the canonical block rather than duplicating commands. Fail when order/text drifts.

- [ ] **Step 2: Add fixture-assets execution**

Run exact commands in isolated container/profile, substituting only fixture release endpoint through environment. Provide fake mpv; prove setup without mpv and first search reaches fixture provider/fake mpv.

- [ ] **Step 3: Register scripts and CI**

```json
"verify:readme:commands": "bun run scripts/verify-readme-commands.ts"
```

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- test/integration/readme-commands.test.ts
bun run verify:readme:commands -- \
  --mode fixture-assets \
  --version 0.3.0 \
  --binary apps/cli/dist/bin/kunai-linux-x64
git commit -m "test(release): validate the exact README quick-start commands"
```

### Task 6: Add compiled binary fake-provider/fake-mpv smokes

**Files:**

- Create fixture provider, scenarios, fake mpv, compiled harness
- Expand `compiled-binary-smoke.test.ts`
- Modify container options/provider bootstrap and package scripts

**Interfaces:**

```ts
export type CompiledSmokeScenarioId =
  | "movie"
  | "series"
  | "anime"
  | "queue-manual"
  | "auto-next"
  | "failed-handoff"
  | "shutdown-restore"
  | "return-to-shell";
```

- [ ] **Step 1: Add test-only provider override**

Container accepts `providerModulesOverride`; compiled fixture requires both `KUNAI_COMPILED_SMOKE=1` and an absolute fixture path. Production startup remains unchanged.

- [ ] **Step 2: Implement fake mpv IPC**

Parse socket argument; respond to observe/get; emit file-loaded, properties, end-file; handle loadfile and quit; record JSONL evidence; support pre-file-loaded failure/hold.

- [ ] **Step 3: Add eight scenario assertions**

Movie history, series episode identity, anime absolute identity, exact manual queue acknowledgement, persistent auto-next loadfile, failed handoff pending recovery, shutdown/restore exact entry, and shell survival after EOF.

Every successful scenario requires `file-loaded` or runtime playback-start evidence.

- [ ] **Step 4: Run and commit**

```bash
bun run build:binary:host
bun run test:binary:smoke
git commit -m "test(release): smoke the compiled playback lifecycle"
```

Stage only provider/container fixture/harness/test/script paths.

### Task 7: Add current default-route provider signoff

**Files:**

- Create: `apps/cli/test/live/release-provider-signoff.smoke.ts`
- Modify provider-matrix smoke/tests/scripts/workflow

**Interfaces:**

```ts
export interface ReleaseProviderSignoff {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly commitSha: string;
  readonly version: string;
  readonly routes: readonly {
    readonly lane: "movie" | "series" | "anime";
    readonly configuredProvider: string;
    readonly successfulProvider: string | null;
    readonly resolved: boolean;
    readonly streamCandidates: number;
    readonly streamReachable: boolean | null;
    readonly failureClass: string | null;
    readonly durationMs: number;
  }[];
}
```

- [ ] **Step 1: Add unit redaction/completeness tests**

Require all three lanes, separate configured/successful provider, no stream URL/token/cookie/home path.

- [ ] **Step 2: Implement opt-in run**

Use stable IDs, isolated profiles, one SHA/version. Evidence accepted only within 24 hours of final approval and all routes resolved/reachable as required.

- [ ] **Step 3: Register workflow artifact and commit**

```bash
git commit -m "test(live): add default-route release signoff"
```

Do not commit timestamped evidence JSON.

### Task 8: Add machine-checked release confirmation gate

**Files:**

- Create: `scripts/release-confirmation-gate.ts`
- Create: `apps/cli/test/unit/scripts/release-confirmation-gate.test.ts`
- Modify package scripts, release/build/CI workflows, release docs

**Interfaces:**

```ts
export interface ReleaseGateEvidence {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly commitSha: string;
  readonly generatedAt: string;
  readonly gates: {
    readonly repository: "passed";
    readonly package: "passed";
    readonly installer: "passed";
    readonly npmGlobalInstall: "passed";
    readonly compiledPlayback: "passed";
    readonly readmeCommands: "passed";
    readonly liveProviders: "passed";
    readonly releaseAssets: "passed";
  };
  readonly providerSignoffRunId: string;
  readonly binaryArtifactName: string;
}
```

- [ ] **Step 1: Add mismatch/staleness/missing-gate tests**

Reject version/SHA mismatch, provider evidence older than 24h, missing lane/gate, incomplete assets, non-staged metadata, public 0.2.6, tracked reference source, and generated drift.

- [ ] **Step 2: Enforce workflow dependency graph**

All deterministic jobs and provider evidence feed the confirmation gate, then protected `release-production`. Publication downloads immutable artifacts and does not rebuild.

- [ ] **Step 3: Run and commit**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/scripts/release-confirmation-gate.test.ts \
  test/unit/scripts/generate-release-notes.test.ts \
  test/unit/scripts/release-changelog.test.ts
bun run guard
bun run release:notes:check
git commit -m "ci(release): enforce the final 0.3.0 confirmation gate"
```

### Task 9: Generate and review the 0.3.0 version unit

**Files:** generated package/changelogs/release metadata/Changesets files

- [ ] **Step 1: Run version generation in the Changesets version PR**

```bash
bun run version:packages
```

- [ ] **Step 2: Review exact diff**

```bash
git diff -- apps/cli/package.json apps/cli/CHANGELOG.md CHANGELOG.md .release .changeset
```

Verify 0.3.0, staged status/null date, no wrapper headings/comments/attribution, no locally invented checksums, and 0.2.6 not public.

- [ ] **Step 3: Run guards**

```bash
bun run guard
bun run release:notes:check
bun run --cwd apps/docs generate
bun run --cwd apps/docs test
```

Allow Changesets automation to author `chore: version packages`.

### Task 10: Execute all gates to the explicit confirmation boundary

- [ ] **Step 1: Deterministic repository gates**

```bash
git status --short
git ls-files docs/installer-reference/claude-code
bun run typecheck
bun run lint
bun run fmt
git diff --exit-code
bun run test
bun run build
bun run pkg:check
bun run guard
bun run release:notes:check
```

Expected: clean tree; no tracked reference source; all pass.

- [ ] **Step 2: Package, installer, docs, artifacts, compiled smokes**

```bash
bun run test:npm-global-install
bun run test:installer:scenarios
KUNAI_INSTALLER_DOCKER=1 bun run test:installer:docker
bun run --cwd apps/docs generate
bun run --cwd apps/docs scripts/check-codegen-freshness.ts
bun run --cwd apps/docs test
bun run --cwd apps/docs build:app
bun run build:binaries
bash apps/cli/scripts/verify-release-binaries.sh
bun run test:binary:smoke
bun run verify:readme:commands -- \
  --mode fixture-assets --version 0.3.0 \
  --binary apps/cli/dist/bin/kunai-linux-x64
```

- [ ] **Step 3: Generate live evidence**

```bash
KUNAI_MATRIX_ARTIFACT="$PWD/artifacts/release-provider-signoff.json" \
  bun run test:live:release-signoff
```

- [ ] **Step 4: Run confirmation checker**

```bash
bun run release:confirmation:check -- \
  --version 0.3.0 \
  --commit "$(git rev-parse HEAD)" \
  --provider-evidence artifacts/release-provider-signoff.json \
  --binary-dir apps/cli/dist/bin
```

Expected: machine-readable ready-for-confirmation result. Nothing has been published.

- [ ] **Step 5: Dispatch real workflow and stop at approval**

```bash
RELEASE_SHA="$(git rev-parse HEAD)"
gh workflow run release.yml --ref "$RELEASE_SHA" \
  -f version="0.3.0" \
  -f provider_signoff_run_id="$PROVIDER_MATRIX_RUN_ID"
```

Watch until every deterministic job passes and the workflow waits on `release-production`. Do not approve. Report evidence and request explicit user confirmation.
