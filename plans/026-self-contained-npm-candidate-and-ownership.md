# Plan 026: Make the npm candidate self-contained and ownership-aware

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` while implementing and `superpowers:verification-before-completion` before reporting success. Follow every checkbox in order. If a STOP condition occurs, report it instead of widening scope.
>
> **Drift check (run first):** `git diff --stat a6214d30..HEAD -- apps/cli/package.json apps/cli/scripts apps/cli/src/services/update apps/cli/test package.json turbo.json`

**Goal:** A locally built npm candidate installs and runs without consulting the public registry, carries only its launcher and platform-package dependencies, and tells the compiled child whether npm or Bun owns it.

**Architecture:** Keep the public `@kitsunekode/kunai` package as a small Node launcher and the eight platform packages as Bun-compiled binaries. Generate a dedicated publish manifest instead of publishing the CLI workspace manifest. Pass an explicit, validated ownership contract from launcher to binary and share its interpretation across update, uninstall, and version display paths.

**Tech stack:** Bun build/test scripts, npm-compatible package manifests, Node ESM launcher, Bun-compiled CLI.

## Status

- **Priority:** P0
- **Effort:** L
- **Risk:** MED
- **Depends on:** none
- **Category:** bug, tests, packaging
- **Planned at:** commit `a6214d30`, 2026-07-22

## Why this matters

The current candidate test packs only the launcher and asks the public npm registry for its exact-version optional dependencies. That makes a new version impossible to validate before publication. The launcher also sets `KUNAI_MANAGED_PACKAGE_ROOT`, but the compiled program never consumes it, so `kunai upgrade`, `kunai uninstall`, and the version banner can report the install as an unknown binary.

## Current state and constraints

- `apps/cli/scripts/npm-launcher.mjs` selects the platform package and spawns its binary. It currently exports only `KUNAI_MANAGED_PACKAGE_ROOT`.
- `apps/cli/package.json` is both a workspace development manifest and the package source. Its published `files` list contains only launcher output, yet it advertises CLI runtime dependencies, `module: dist/kunai.js`, and `engines.bun`.
- `apps/cli/test/integration/npm-global-install.test.ts` builds and packs the launcher, then performs a registry-dependent global install.
- `apps/cli/src/services/update/install-method.ts` infers ownership from `process.argv` paths; that cannot work after the launcher starts a standalone compiled binary.
- Bun is embedded in every compiled platform binary. The npm launcher needs Node; the installed CLI does not need a separately installed Bun runtime.
- Do not add postinstall download logic. The exact-version optional platform packages remain the delivery mechanism.

## Scope

**In scope:**

- `apps/cli/scripts/build.ts`
- `apps/cli/scripts/build-npm-platform-packages.ts`
- `apps/cli/scripts/npm-launcher.mjs`
- `apps/cli/scripts/verify-npm-pack.ts`
- `apps/cli/scripts/write-npm-publish-manifest.ts` (create)
- `apps/cli/src/services/update/managed-package-context.ts` (create)
- `apps/cli/src/services/update/install-method.ts`
- `apps/cli/src/services/update/version-display.ts`
- `apps/cli/src/services/update/run-upgrade.ts`
- `apps/cli/src/services/update/run-uninstall.ts`
- `apps/cli/test/integration/npm-global-install.test.ts`
- `apps/cli/test/integration/npm-launcher.test.ts`
- `apps/cli/test/unit/services/update/install-method.test.ts`
- `apps/cli/test/unit/run-uninstall.test.ts`
- `apps/cli/test/unit/scripts/distribution-contract.test.ts`
- `apps/cli/package.json`, root `package.json`, `turbo.json`

**Out of scope:** release publication credentials/workflow (plan 027), bootstrap installers (plan 028), user docs (plan 030), changing the eight target triples.

## Target interfaces

Create `managed-package-context.ts` with this exact public shape:

```ts
export type ManagedPackageManager = "npm" | "bun";
export interface ManagedPackageContext {
  manager: ManagedPackageManager;
  packageRoot: string;
}
export function readManagedPackageContext(
  env: Record<string, string | undefined> = process.env,
): ManagedPackageContext | null;
```

The launcher must pass both values:

```js
env: {
  ...process.env,
  KUNAI_MANAGED_PACKAGE_MANAGER: manager,
  KUNAI_MANAGED_PACKAGE_ROOT: packageRoot,
}
```

Reject an unknown manager or an empty/non-absolute root; do not silently trust arbitrary environment input. `detectInstallMethod` must prefer valid managed context over compiled-binary fallback and return `npm-global` or `bun-global` with the package root as evidence.

The generated launcher manifest must have this semantic shape:

```json
{
  "name": "@kitsunekode/kunai",
  "version": "<workspace version>",
  "description": "<workspace description>",
  "keywords": ["<workspace keywords>"],
  "homepage": "<workspace homepage>",
  "bugs": { "url": "<workspace issue tracker>" },
  "license": "MIT",
  "author": "<workspace author>",
  "repository": { "type": "git", "url": "<workspace repository>" },
  "type": "module",
  "bin": { "kunai": "dist/npm-launcher.mjs" },
  "files": ["dist/npm-launcher.mjs", "LICENSE"],
  "engines": { "node": ">=18.17" },
  "optionalDependencies": {
    "@kitsunekode/kunai-darwin-arm64": "0.3.0",
    "@kitsunekode/kunai-darwin-x64": "0.3.0",
    "@kitsunekode/kunai-linux-arm64": "0.3.0",
    "@kitsunekode/kunai-linux-arm64-musl": "0.3.0",
    "@kitsunekode/kunai-linux-x64": "0.3.0",
    "@kitsunekode/kunai-linux-x64-musl": "0.3.0",
    "@kitsunekode/kunai-windows-arm64": "0.3.0",
    "@kitsunekode/kunai-windows-x64": "0.3.0"
  },
  "publishConfig": { "access": "public", "provenance": true }
}
```

Here `0.3.0` illustrates the current workspace version; the generator must derive that value rather than hardcode it. Public discovery and ownership metadata is selected from the workspace manifest, while the license and public/provenance publication policy are validated before generation. The manifest must not contain `dependencies`, `peerDependencies`, `module`, `engines.bun`, lifecycle scripts, or source files. The public tarball contains exactly `package.json`, `dist/npm-launcher.mjs`, and the copied repository `LICENSE`.

## Tasks

### Task 1: Lock the publish-manifest contract with failing tests

- [ ] Add pure-function assertions to `distribution-contract.test.ts` that the generated package has the policy-safe fields above and every optional dependency equals the root package version.
- [ ] Extend `verify-npm-pack.ts` assertions so the tarball contains exactly `package.json`, `dist/npm-launcher.mjs`, and `LICENSE`, and rejects forbidden runtime dependencies, entrypoints, lifecycle scripts, and source files.
- [ ] Run `bun run --cwd apps/cli test test/unit/scripts/distribution-contract.test.ts`; expect the new assertions to fail before implementation.

### Task 2: Generate and pack the minimal launcher package

- [ ] Implement `write-npm-publish-manifest.ts` as a pure `buildNpmPublishManifest(source)` function plus a CLI wrapper that writes to `apps/cli/dist/npm/package.json` using `Bun.write`.
- [ ] Copy `npm-launcher.mjs` and the repository `LICENSE` to `dist/npm`; change root `release:pack` to pack from `apps/cli/dist/npm`, not the workspace directory.
- [ ] Add `dist/kunai.mjs` and `dist/npm/**` to `turbo.json` build outputs.
- [ ] Run `bun run build && bun run release:pack && bun run pkg:check`; expect exit 0 and no registry access.
- [ ] Commit: `fix(packaging): generate minimal npm launcher package`.

### Task 3: Make the candidate install hermetic

- [ ] Change `npm-global-install.test.ts` to build and pack the launcher plus the host platform package into a temporary directory.
- [ ] Install both tarballs in one command into a temporary prefix: `npm install --global --ignore-scripts --offline <host-platform.tgz> <launcher.tgz>`.
- [ ] Run the installed `kunai --version`, assert exit 0 and the candidate version, then assert the installed launcher resolves the binary under that temporary prefix.
- [ ] Keep separate assertions that all eight platform package manifests/tarballs are generated and exact-version pinned; only execute the host binary.
- [ ] Run `bun run test:npm-global-install`; expect completion without network and exit 0.
- [ ] Commit: `test(packaging): install npm candidate entirely from local tarballs`.

### Task 4: Carry package-manager ownership across the launcher boundary

- [ ] Add failing launcher tests for npm and Bun roots and for preservation of unrelated environment variables.
- [ ] Determine manager from the launcher path/root (`.bun/install/global` means Bun; otherwise npm) and set both environment variables shown in Target interfaces.
- [ ] Add unit tests for valid npm/Bun contexts and rejection of invalid manager, missing root, and relative root.
- [ ] Implement `readManagedPackageContext`; make `detectInstallMethod` consume it before path heuristics.
- [ ] Make `runUninstall` fall back to `detectInstallMethod` when no install manifest exists, matching `runUpgrade`; cover compiled-child npm and Bun cases.
- [ ] Ensure `version-display.ts` uses the same detected method rather than a separate parser.
- [ ] Run `bun run --cwd apps/cli test test/integration/npm-launcher.test.ts test/unit/services/update/install-method.test.ts test/unit/run-uninstall.test.ts`; expect all pass.
- [ ] Commit: `fix(update): preserve npm and bun install ownership`.

### Task 5: Run the complete gate

- [ ] Run `bun run typecheck`, `bun run lint`, `bun run fmt`, `bun run build`, `bun run pkg:check`, and `bun run test:npm-global-install`; every command must exit 0.
- [ ] Run `git diff --check`; expect no output.
- [ ] Update this plan's row in `plans/README.md` only after all gates pass.

## STOP conditions

- Packing from `dist/npm` changes any public package name or any of the eight target mappings.
- A hermetic install requires publishing to the real npm registry or adding lifecycle download code.
- Ownership detection would require trusting an unvalidated executable path supplied by the environment.
- Any command requires a system-wide install outside a temporary prefix.

## Maintenance notes

The workspace manifest may continue to carry development dependencies; only the generated publish manifest defines the public launcher package. If a ninth target is added, update the shared platform target source so the build, manifest generator, verifier, and tests derive from one list rather than adding four literals.
