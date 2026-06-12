# Cross-Platform Distribution & Installer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Kunai as zero-prerequisite compiled binaries with a coherent, channel-aware install/upgrade/uninstall system across Linux, macOS, and Windows, while keeping npm/bun/source as first-class fallbacks.

**Architecture:** A `bun build --compile` matrix produces 5 single-file binaries (Bun runtime embedded) hosted on GitHub Releases behind one swappable `KUNAI_DL_BASE`. Runtime assets (VidKing WASM + mpv Lua) are embedded and extracted at startup via a single `resolveRuntimeAsset` seam. An install manifest records the channel; `kunai upgrade`/`--uninstall` route per channel and never stomp another. Release CI publishes npm + binaries for the same version in one run.

**Tech Stack:** Bun (build/compile/runtime), TypeScript, bash, PowerShell, GitHub Actions, `bun:sqlite`-adjacent OS path helpers (`@kunai/storage`), existing `detectInstallMethod` service.

**Reference spec:** `docs/superpowers/specs/2026-06-13-cross-platform-distribution-installer-design.md`

**Key existing seams to reuse (do NOT duplicate):**

- `packages/storage/src/paths.ts` → `getKunaiPaths()` (`configDir`, `cacheDir`, `mpvBridgePath`).
- `apps/cli/src/infra/player/kunai-mpv-bridge.ts` → `bundledKunaiMpvBridgePath()` (packaged/dev resolver to extend).
- `packages/providers/src/videasy/direct.ts:1473-1495` → `loadWasmExports()` (WASM path to swap).
- `apps/cli/src/services/update/install-method.ts` → `detectInstallMethod()` + `updateGuidanceForInstallMethod()` (heuristic fallback to reuse).
- `apps/cli/src/main.ts:106-253` → `parseArgs()` + `runCli()` (flag wiring).

---

## Task 1: Runtime asset resolution seam (`resolveRuntimeAsset`)

**Why first:** Without this, a single-file compiled binary cannot find the WASM or mpv Lua (no sibling `dist/assets/`). Everything else depends on a binary that actually runs.

> **AMENDED during execution (verified empirically 2026-06-13):** `@kunai/providers` depends on `@kunai/core`+`@kunai/types` only (NOT `@kunai/storage`), so the original storage-coupled `resolveRuntimeAsset` util is dropped. Verified Bun behavior: an `import x from "./f" with { type: "file" }` resolves to a real path in dev/npm-bundle and to a `/$bunfs/...` path in a compiled binary; `Bun.file()` reads both and `existsSync()` returns true for both, but **Node `fs.copyFile` fails on `/$bunfs/` paths — only `Bun.write()` works**. Therefore:
>
> - **WASM (providers):** read bytes directly via `Bun.file(embeddedImport).arrayBuffer()` — no extraction, no storage dep, no new util.
> - **mpv Lua (cli):** source from an embedded import and switch the existing copy from Node `copyFile` → `Bun.write` (handles bunfs). The existing "copy to writable config dir" flow is preserved.
>
> The `extractEmbeddedAsset`/`resolveRuntimeAsset`/`isCompiledBinary` files in Steps 3-6 below are superseded by this simpler approach; the real steps implemented are in this amendment.

**Files:**

- Create: `apps/cli/src/infra/build/runtime-assets.ts`
- Create: `apps/cli/test/unit/runtime-assets.test.ts`
- Modify: `packages/providers/src/videasy/direct.ts:1473-1495`
- Modify: `apps/cli/src/infra/player/kunai-mpv-bridge.ts:14-27`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/runtime-assets.test.ts
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractEmbeddedAsset } from "@/infra/build/runtime-assets";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("extractEmbeddedAsset writes bytes once and is idempotent", async () => {
  const cacheRoot = mkdtempSync(join(tmpdir(), "kunai-asset-"));
  made.push(cacheRoot);
  const src = join(cacheRoot, "src.bin");
  writeFileSync(src, "HELLO");

  const a = await extractEmbeddedAsset({
    name: "demo.bin",
    version: "9.9.9",
    cacheDir: cacheRoot,
    readBytes: async () => new Uint8Array(await Bun.file(src).arrayBuffer()),
  });
  const b = await extractEmbeddedAsset({
    name: "demo.bin",
    version: "9.9.9",
    cacheDir: cacheRoot,
    readBytes: async () => {
      throw new Error("should not re-read when already extracted");
    },
  });

  expect(a).toBe(b);
  expect(await Bun.file(a).text()).toBe("HELLO");
  expect(a).toContain(join("assets", "9.9.9", "demo.bin"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/runtime-assets.test.ts`
Expected: FAIL — `Cannot find module '@/infra/build/runtime-assets'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/cli/src/infra/build/runtime-assets.ts
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import packageJson from "../../../package.json" with { type: "json" };

/** True when running inside a `bun build --compile` single-file executable. */
export function isCompiledBinary(): boolean {
  // Bun maps the embedded entry under the virtual `/$bunfs/` root.
  return (process.argv[1] ?? "").includes("/$bunfs/");
}

export type ExtractEmbeddedAssetInput = {
  readonly name: string;
  readonly version: string;
  readonly cacheDir: string;
  readonly readBytes: () => Promise<Uint8Array>;
};

/**
 * Extract an embedded asset to `<cacheDir>/assets/<version>/<name>` exactly once.
 * Version-scoped so an upgraded binary re-extracts fresh bytes. Atomic: temp file
 * in the same dir + rename (CLAUDE.md fs guidance).
 */
export async function extractEmbeddedAsset(input: ExtractEmbeddedAssetInput): Promise<string> {
  const dest = join(input.cacheDir, "assets", input.version, input.name);
  if (existsSync(dest)) return dest;

  await mkdir(dirname(dest), { recursive: true });
  const bytes = await input.readBytes();
  const tmp = `${dest}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, dest);
  return dest;
}

export type RuntimeAssetName = "vidking-wasm" | "mpv-lua";

/**
 * Absolute path to a runtime asset, valid in dev/npm (on-disk sibling) and
 * compiled-binary (extract-from-embed) modes. `embedded` supplies the bytes that
 * Bun bundled via `with { type: "file" }`; only consulted in binary mode.
 */
export async function resolveRuntimeAsset(
  name: RuntimeAssetName,
  diskPath: string,
  embedded: () => Promise<Uint8Array>,
): Promise<string> {
  if (!isCompiledBinary() && existsSync(diskPath)) return diskPath;
  return extractEmbeddedAsset({
    name: name === "vidking-wasm" ? "module1_patched.wasm" : "kunai-bridge.lua",
    version: packageJson.version,
    cacheDir: getKunaiPaths().cacheDir,
    readBytes: embedded,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/runtime-assets.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 5: Wire the VidKing WASM loader to the seam**

In `packages/providers/src/videasy/direct.ts`, replace the body of `loadWasmExports` WASM read. NOTE: this file lives in `@kunai/providers`; import the asset bytes there and pass them through. Change:

```ts
// packages/providers/src/videasy/direct.ts  (inside loadWasmExports)
import wasmFile from "./assets/module1_patched.wasm" with { type: "file" };
import { resolveRuntimeAsset } from "@kunai/providers/runtime-asset-bridge";
// ...
const wasmPath = await resolveRuntimeAsset(
  "vidking-wasm",
  new URL("./assets/module1_patched.wasm", import.meta.url).pathname,
  async () => new Uint8Array(await Bun.file(wasmFile).arrayBuffer()),
);
const wasmBuffer = await Bun.file(wasmPath).arrayBuffer();
```

Because `@kunai/providers` must not depend on the CLI app, add a thin re-export so the seam is reachable from the package without a circular dep: create `packages/providers/src/runtime-asset-bridge.ts` that re-implements `resolveRuntimeAsset` against `@kunai/storage` (the providers package already depends on storage). Keep the algorithm identical; share the type. (If a shared `@kunai/core` util is cleaner, place it there and import from both — confirm during execution which package both can see.)

- [ ] **Step 6: Wire the mpv Lua bridge to the seam**

In `apps/cli/src/infra/player/kunai-mpv-bridge.ts`, extend `bundledKunaiMpvBridgePath` to fall back to extraction in binary mode:

```ts
import luaFile from "../../../assets/mpv/kunai-bridge.lua" with { type: "file" };
import { isCompiledBinary, extractEmbeddedAsset } from "@/infra/build/runtime-assets";
import { getKunaiPaths } from "@kunai/storage";
import packageJson from "../../../package.json" with { type: "json" };

export async function resolveBundledKunaiMpvBridgePath(): Promise<string> {
  const onDisk = bundledKunaiMpvBridgePath();
  if (!isCompiledBinary() && existsSync(onDisk)) return onDisk;
  return extractEmbeddedAsset({
    name: "kunai-bridge.lua",
    version: packageJson.version,
    cacheDir: getKunaiPaths().cacheDir,
    readBytes: async () => new Uint8Array(await Bun.file(luaFile).arrayBuffer()),
  });
}
```

Then update `resolveKunaiMpvBridgeScriptPath` (line ~62) to `const bundled = await resolveBundledKunaiMpvBridgePath();`.

- [ ] **Step 7: Run the full unit suite + typecheck**

Run: `bun run --cwd apps/cli test:unit && bun run --cwd apps/cli typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/infra/build/runtime-assets.ts apps/cli/test/unit/runtime-assets.test.ts \
  packages/providers/src/videasy/direct.ts packages/providers/src/runtime-asset-bridge.ts \
  apps/cli/src/infra/player/kunai-mpv-bridge.ts
git commit -m "feat(build): embed+extract runtime assets for single-file binaries"
```

---

## Task 2: Binary build script (`build-binaries.ts`)

> **AMENDED during execution (2026-06-13):** Implemented with the **`Bun.build` JS API** (`compile: { target, outfile }`), NOT the `bun build --compile` CLI — the CLI form cannot run plugins, so it fails to resolve `react-devtools-core`. The stub plugin + `DEV` define were extracted to a shared `apps/cli/scripts/build-shared.ts` and are reused by both `build.ts` and `build-binaries.ts`. **`--bytecode` was dropped:** it cannot compile Ink/yoga's top-level `await` (parse errors). Verified: linux-x64 binary runs in a clean `env -i` (no external Bun) and the embedded VidKing WASM instantiates inside the compiled binary; windows-x64 cross-compiles to a valid PE32+ executable. The npm bundle minify (originally Task 10) also landed here via the shared config (4.2 MB → 2.17 MB).

**Files:**

- Create: `apps/cli/scripts/build-binaries.ts`
- Modify: `apps/cli/package.json` (add `build:binaries` script)
- Modify: `package.json` (root: add `build:binaries` passthrough)

- [ ] **Step 1: Write the build script**

```ts
#!/usr/bin/env bun
// apps/cli/scripts/build-binaries.ts
// Cross-compiles all release targets from one host and emits SHA256SUMS.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const ENTRY = join(ROOT, "src/main.ts");
const OUT = join(ROOT, "dist/bin");

const TARGETS = [
  { triple: "bun-linux-x64", out: "kunai-linux-x64" },
  { triple: "bun-linux-arm64", out: "kunai-linux-arm64" },
  { triple: "bun-darwin-x64", out: "kunai-darwin-x64" },
  { triple: "bun-darwin-arm64", out: "kunai-darwin-arm64" },
  { triple: "bun-windows-x64", out: "kunai-windows-x64.exe" },
] as const;

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const sums: string[] = [];
  for (const t of TARGETS) {
    const outfile = join(OUT, t.out);
    console.log(`[binaries] compiling ${t.out} (${t.triple})`);
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        ENTRY,
        "--compile",
        "--minify",
        "--bytecode",
        `--target=${t.triple}`,
        "--outfile",
        outfile,
      ],
      { stdout: "inherit", stderr: "inherit", cwd: ROOT },
    );
    const code = await proc.exited;
    if (code !== 0) throw new Error(`[binaries] compile failed for ${t.triple}`);
    sums.push(`${await sha256(outfile)}  ${t.out}`);
  }

  await writeFile(join(OUT, "SHA256SUMS"), `${sums.join("\n")}\n`);
  console.log(`[binaries] wrote ${TARGETS.length} binaries + SHA256SUMS to ${OUT}`);
}

await main();
```

- [ ] **Step 2: Add package scripts**

In `apps/cli/package.json` `scripts`, add: `"build:binaries": "bun run scripts/build-binaries.ts"`.
In root `package.json` `scripts`, add: `"build:binaries": "bun run --cwd apps/cli build:binaries"`.

- [ ] **Step 3: Build locally and smoke-run the native binary**

Run: `bun run --cwd apps/cli build:binaries`
Then (Linux host): `./apps/cli/dist/bin/kunai-linux-x64 --version`
Expected: prints the version (matches `apps/cli/package.json`), exits 0. `dist/bin/SHA256SUMS` has 5 lines.

- [ ] **Step 4: Verify an asset path resolves inside the binary**

Run: `./apps/cli/dist/bin/kunai-linux-x64 --help` then `ls "$(bun -e 'console.log(require("@kunai/storage").getKunaiPaths().cacheDir)')/assets"`
Expected: after any run that touches mpv/WASM, `assets/<version>/` exists. (If not exercised by `--help`, defer hard check to Task 9 CI smoke.)

- [ ] **Step 5: Commit**

```bash
git add apps/cli/scripts/build-binaries.ts apps/cli/package.json package.json
git commit -m "feat(build): cross-compile release binaries + checksums"
```

---

## Task 3: Install manifest (extends `detectInstallMethod`)

**Files:**

- Create: `apps/cli/src/services/update/install-manifest.ts`
- Create: `apps/cli/test/unit/install-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/install-manifest.test.ts
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInstallManifest, writeInstallManifest } from "@/services/update/install-manifest";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("write then read round-trips the manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  await writeInstallManifest(
    { channel: "binary", version: "1.2.3", binPath: "/x/kunai", dlBase: "https://dl" },
    dir,
  );
  const m = await readInstallManifest(dir);
  expect(m?.channel).toBe("binary");
  expect(m?.version).toBe("1.2.3");
  expect(typeof m?.installedAt).toBe("string");
});

test("read returns null when manifest is absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kunai-manifest-"));
  made.push(dir);
  expect(await readInstallManifest(dir)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/install-manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/cli/src/services/update/install-manifest.ts
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getKunaiPaths } from "@kunai/storage";

import type { InstallMethodKind } from "./install-method";

export type InstallManifest = {
  readonly channel: InstallMethodKind;
  readonly version: string;
  readonly binPath: string;
  readonly dlBase: string;
  readonly installedAt: string;
};

const FILENAME = "install.json";

export async function readInstallManifest(
  configDir = getKunaiPaths().configDir,
): Promise<InstallManifest | null> {
  const path = join(configDir, FILENAME);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as InstallManifest;
  } catch {
    return null;
  }
}

export async function writeInstallManifest(
  partial: Omit<InstallManifest, "installedAt">,
  configDir = getKunaiPaths().configDir,
): Promise<void> {
  const path = join(configDir, FILENAME);
  await mkdir(configDir, { recursive: true });
  const full: InstallManifest = { ...partial, installedAt: new Date().toISOString() };
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(full, null, 2)}\n`);
  await rename(tmp, path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/install-manifest.test.ts`
Expected: PASS (3 assertions across 2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/update/install-manifest.ts apps/cli/test/unit/install-manifest.test.ts
git commit -m "feat(update): channel-aware install manifest"
```

---

## Task 4: Version resolution + channel-aware upgrade planner

**Why a planner:** Keep network/exec side effects out of the decision logic so it is unit-testable. The planner returns _what to do_; a thin runner executes it.

**Files:**

- Create: `apps/cli/src/services/update/upgrade-planner.ts`
- Create: `apps/cli/test/unit/upgrade-planner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/cli/test/unit/upgrade-planner.test.ts
import { expect, test } from "bun:test";
import { planUpgrade } from "@/services/update/upgrade-planner";

const base = {
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  binPath: "/x/kunai",
  dlBase: "https://dl",
};

test("npm channel plans a global npm install command", () => {
  const p = planUpgrade({ ...base, channel: "npm-global" });
  expect(p.kind).toBe("exec");
  expect(p.command).toEqual(["npm", "i", "-g", "@kitsunekode/kunai@latest"]);
});

test("binary channel plans a self-replace from dlBase", () => {
  const p = planUpgrade({ ...base, channel: "binary", os: "linux", arch: "x64" });
  expect(p.kind).toBe("self-replace");
  expect(p.assetName).toBe("kunai-linux-x64");
  expect(p.downloadUrl).toContain("https://dl");
});

test("already-latest plans a no-op", () => {
  const p = planUpgrade({
    ...base,
    latestVersion: "1.0.0",
    channel: "binary",
    os: "linux",
    arch: "x64",
  });
  expect(p.kind).toBe("up-to-date");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/upgrade-planner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/cli/src/services/update/upgrade-planner.ts
import type { InstallMethodKind } from "./install-method";

export type UpgradeOs = "linux" | "darwin" | "windows";
export type UpgradeArch = "x64" | "arm64";

export type PlanUpgradeInput = {
  readonly channel: InstallMethodKind;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly binPath: string;
  readonly dlBase: string;
  readonly os?: UpgradeOs;
  readonly arch?: UpgradeArch;
};

export type UpgradePlan =
  | { kind: "up-to-date" }
  | { kind: "exec"; command: string[]; cwd?: string }
  | {
      kind: "self-replace";
      assetName: string;
      downloadUrl: string;
      checksumUrl: string;
      binPath: string;
    }
  | { kind: "manual"; message: string };

const PKG = "@kitsunekode/kunai";

function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => Number.parseInt(n, 10));
  const b = current.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export function assetNameFor(os: UpgradeOs, arch: UpgradeArch): string {
  return os === "windows" ? "kunai-windows-x64.exe" : `kunai-${os}-${arch}`;
}

export function planUpgrade(input: PlanUpgradeInput): UpgradePlan {
  if (!isNewer(input.latestVersion, input.currentVersion)) return { kind: "up-to-date" };

  switch (input.channel) {
    case "npm-global":
      return { kind: "exec", command: ["npm", "i", "-g", `${PKG}@latest`] };
    case "bun-global":
      return { kind: "exec", command: ["bun", "i", "-g", `${PKG}@latest`] };
    case "source":
      return {
        kind: "manual",
        message:
          "Source checkout: run `git pull --ff-only`, then `bun install && bun run build && bun run relink:global`.",
      };
    case "binary": {
      const os = input.os;
      const arch = input.arch;
      if (!os || !arch)
        return { kind: "manual", message: "Could not detect OS/arch for binary upgrade." };
      const tag = `v${input.latestVersion}`;
      const asset = assetNameFor(os, arch);
      return {
        kind: "self-replace",
        assetName: asset,
        downloadUrl: `${input.dlBase}/download/${tag}/${asset}`,
        checksumUrl: `${input.dlBase}/download/${tag}/SHA256SUMS`,
        binPath: input.binPath,
      };
    }
    default:
      return { kind: "manual", message: "Unknown install method; upgrade manually." };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/upgrade-planner.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/update/upgrade-planner.ts apps/cli/test/unit/upgrade-planner.test.ts
git commit -m "feat(update): channel-aware upgrade planner"
```

---

## Task 5: Atomic self-replace (per-OS) + latest-version fetch + `kunai upgrade` runner

**Files:**

- Create: `apps/cli/src/services/update/self-replace.ts`
- Create: `apps/cli/src/services/update/latest-version.ts`
- Create: `apps/cli/src/services/update/run-upgrade.ts`
- Create: `apps/cli/test/unit/self-replace.test.ts`
- Modify: `apps/cli/src/main.ts` (subcommand + `.old` cleanup at startup)

- [ ] **Step 1: Write the failing test for the checksum-verified replace decision**

```ts
// apps/cli/test/unit/self-replace.test.ts
import { expect, test } from "bun:test";
import { pickChecksum, verifyChecksum } from "@/services/update/self-replace";

test("pickChecksum finds the matching line in SHA256SUMS", () => {
  const sums = "aaaa  kunai-linux-x64\nbbbb  kunai-darwin-arm64\n";
  expect(pickChecksum(sums, "kunai-darwin-arm64")).toBe("bbbb");
});

test("verifyChecksum rejects a mismatch", () => {
  expect(verifyChecksum("dead", "beef")).toBe(false);
  expect(verifyChecksum("beef", "beef")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/self-replace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `self-replace.ts`**

```ts
// apps/cli/src/services/update/self-replace.ts
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function pickChecksum(sumsFile: string, assetName: string): string | null {
  for (const line of sumsFile.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === assetName) return hash ?? null;
  }
  return null;
}

export function verifyChecksum(actual: string, expected: string): boolean {
  return actual.length > 0 && actual === expected;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Delete stale `<binary>.old` left by a prior Windows self-replace. Safe everywhere. */
export async function cleanupOldBinary(binPath: string): Promise<void> {
  const dir = dirname(binPath);
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir)) {
    if (entry.endsWith(".old")) {
      await rm(join(dir, entry), { force: true }).catch(() => {});
    }
  }
}

export type SelfReplaceInput = {
  readonly binPath: string;
  readonly bytes: Uint8Array;
  readonly expectedSha256: string;
  readonly platform?: NodeJS.Platform;
};

/**
 * Atomically replace the running binary. Same-volume temp + rename.
 * Windows: rename running exe aside to `.old`, then move new into place.
 */
export async function selfReplace(input: SelfReplaceInput): Promise<void> {
  const actual = await sha256(input.bytes);
  if (!verifyChecksum(actual, input.expectedSha256)) {
    throw new Error(`Checksum mismatch: expected ${input.expectedSha256}, got ${actual}`);
  }

  const platform = input.platform ?? process.platform;
  const dir = dirname(input.binPath);
  const tmp = join(dir, `.kunai-new-${process.pid}`);
  await writeFile(tmp, input.bytes);
  await chmod(tmp, 0o755).catch(() => {});

  if (platform === "win32") {
    const aside = `${input.binPath}.old`;
    await rm(aside, { force: true }).catch(() => {});
    await renameWithRetry(input.binPath, aside);
    await renameWithRetry(tmp, input.binPath);
    return;
  }
  await rename(tmp, input.binPath);
}

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await Bun.sleep(150 * (i + 1));
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/self-replace.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write `latest-version.ts`**

```ts
// apps/cli/src/services/update/latest-version.ts
const RELEASES_API = "https://api.github.com/repos/KitsuneKode/kunai/releases/latest";

/** Resolve the latest released version (tag like `v1.2.3` → `1.2.3`). */
export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
  url = RELEASES_API,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": "kunai-cli" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string };
    return body.tag_name ? body.tag_name.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Write `run-upgrade.ts` (the thin runner that ties planner + fetch + replace + manifest together)**

```ts
// apps/cli/src/services/update/run-upgrade.ts
import { detectInstallMethod } from "./install-method";
import { fetchLatestVersion } from "./latest-version";
import { readInstallManifest, writeInstallManifest } from "./install-manifest";
import { assetNameFor, planUpgrade, type UpgradeArch, type UpgradeOs } from "./upgrade-planner";
import { cleanupOldBinary, pickChecksum, selfReplace } from "./self-replace";

const DEFAULT_DL_BASE = "https://github.com/KitsuneKode/kunai/releases";

function currentOs(): UpgradeOs | null {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "windows";
  return null;
}
function currentArch(): UpgradeArch | null {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  return null;
}

export type RunUpgradeOptions = { readonly checkOnly?: boolean; readonly currentVersion: string };

export async function runUpgrade(opts: RunUpgradeOptions): Promise<number> {
  const manifest = await readInstallManifest();
  const channel = manifest?.channel ?? detectInstallMethod({ fileExists: existsSyncBridge }).kind;
  const binPath = manifest?.binPath ?? process.execPath;
  const dlBase = manifest?.dlBase ?? DEFAULT_DL_BASE;

  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error("Could not resolve the latest version (network/API). Try again later.");
    return 1;
  }

  const os = currentOs() ?? undefined;
  const arch = currentArch() ?? undefined;
  const plan = planUpgrade({
    channel,
    currentVersion: opts.currentVersion,
    latestVersion: latest,
    binPath,
    dlBase,
    os,
    arch,
  });

  if (plan.kind === "up-to-date") {
    console.log(`kunai is up to date (${opts.currentVersion}).`);
    return 0;
  }
  console.log(`Update available: ${opts.currentVersion} → ${latest} (channel: ${channel}).`);
  if (opts.checkOnly) return 0;

  if (plan.kind === "manual") {
    console.log(plan.message);
    return 0;
  }
  if (plan.kind === "exec") {
    const proc = Bun.spawn(plan.command, { stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    if (code === 0 && os && arch) {
      await writeInstallManifest({ channel, version: latest, binPath, dlBase });
    }
    return code;
  }
  // self-replace
  const [binRes, sumRes] = await Promise.all([fetch(plan.downloadUrl), fetch(plan.checksumUrl)]);
  if (!binRes.ok || !sumRes.ok) {
    console.error(
      `Download failed (${binRes.status}/${sumRes.status}). Try \`--method npm\` or retry.`,
    );
    return 1;
  }
  const expected = pickChecksum(await sumRes.text(), plan.assetName);
  if (!expected) {
    console.error(`No checksum entry for ${plan.assetName}; aborting.`);
    return 1;
  }
  await selfReplace({
    binPath,
    bytes: new Uint8Array(await binRes.arrayBuffer()),
    expectedSha256: expected,
  });
  await writeInstallManifest({ channel, version: latest, binPath, dlBase });
  console.log(`Updated to ${latest}.`);
  return 0;
}

// Bridge so detectInstallMethod can probe the filesystem without importing node:fs at module top.
function existsSyncBridge(path: string): boolean {
  return require("node:fs").existsSync(path);
}

void assetNameFor; // referenced for type completeness in tests
```

- [ ] **Step 7: Wire the subcommand + startup cleanup into `main.ts`**

In `apps/cli/src/main.ts`, near the top of `runCli` (line ~549), before building the shell, handle the `upgrade` subcommand and clean stale `.old`:

```ts
// at top of runCli(argv), after parseArgs:
if (argv[0] === "upgrade") {
  const { runUpgrade } = await import("./services/update/run-upgrade");
  const checkOnly = argv.includes("--check");
  process.exit(await runUpgrade({ checkOnly, currentVersion: KUNAI_VERSION }));
}
// best-effort: remove any leftover Windows self-replace artifact
void import("./services/update/self-replace").then(({ cleanupOldBinary }) =>
  cleanupOldBinary(process.execPath).catch(() => {}),
);
```

Also add `--uninstall` handling here that defers to Task 8's logic (added in that task).

- [ ] **Step 8: Run unit suite + typecheck**

Run: `bun run --cwd apps/cli test:unit && bun run --cwd apps/cli typecheck`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/services/update/self-replace.ts apps/cli/src/services/update/latest-version.ts \
  apps/cli/src/services/update/run-upgrade.ts apps/cli/test/unit/self-replace.test.ts apps/cli/src/main.ts
git commit -m "feat(update): kunai upgrade with per-OS atomic self-replace"
```

---

## Task 6: Rewrite `install.sh` (binary default, tty-correct, channel-aware)

**Files:**

- Modify: `install.sh` (full rewrite)

- [ ] **Step 1: Replace `install.sh` with the binary-first, tty-correct version**

Create the file with this content (the critical fixes vs today: prompts read from `/dev/tty`; binary is the default method; correct per-method PATH hint; writes the install manifest; `--upgrade`/`--uninstall` flags):

```bash
#!/usr/bin/env bash
# Kunai installer — binary-first, channel-aware, cross-platform.
#   curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
#   ./install.sh [--method binary|npm|bun|source] [--version X.Y.Z] [--upgrade] [--uninstall] [--yes] [--dry-run]
set -euo pipefail

KUNAI_REPO="${KUNAI_REPO:-https://github.com/KitsuneKode/kunai.git}"
KUNAI_PACKAGE="${KUNAI_PACKAGE:-@kitsunekode/kunai}"
KUNAI_DL_BASE="${KUNAI_DL_BASE:-https://github.com/KitsuneKode/kunai/releases}"
BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${KUNAI_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kunai}"
METHOD="binary"; VERSION="latest"; DRY=0; YES=0; ACTION="install"

info() { printf '→ %s\n' "$*"; }
warn() { printf '! \033[33m%s\033[0m\n' "$*"; }
err()  { printf '✗ %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

ask() { # ask "question" default(y/n) ; reads from the terminal, not the pipe
  local q="$1" d="${2:-y}" reply
  if [[ "$YES" == 1 || ! -e /dev/tty ]]; then [[ "$d" == y ]]; return; fi
  read -r -p "$q [$d] " reply </dev/tty || true
  reply="${reply:-$d}"; [[ "$reply" =~ ^([yY]|yes)$ ]]
}

run() { if [[ "$DRY" == 1 ]]; then printf '→ [dry-run]'; printf ' %q' "$@"; printf '\n'; else "$@"; fi; }

detect_os() { case "$(uname -s)" in Linux) echo linux;; Darwin) echo darwin;; *) echo unknown;; esac; }
detect_arch() { case "$(uname -m)" in x86_64|amd64) echo x64;; aarch64|arm64) echo arm64;; *) echo unknown;; esac; }

write_manifest() {
  local channel="$1" version="$2" binpath="$3"
  [[ "$DRY" == 1 ]] && { info "[dry-run] would write manifest ($channel) to $CONFIG_DIR/install.json"; return; }
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/install.json" <<JSON
{
  "channel": "$channel",
  "version": "$version",
  "binPath": "$binpath",
  "dlBase": "$KUNAI_DL_BASE",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

install_binary() {
  local os arch asset url sums tmp
  os="$(detect_os)"; arch="$(detect_arch)"
  [[ "$os" == unknown || "$arch" == unknown ]] && { err "Unsupported OS/arch for a prebuilt binary. Try --method npm or --method source."; exit 1; }
  if [[ "$os" == windows ]]; then asset="kunai-windows-x64.exe"; else asset="kunai-${os}-${arch}"; fi
  if [[ "$VERSION" == latest ]]; then url="$KUNAI_DL_BASE/latest/download/$asset"; sums="$KUNAI_DL_BASE/latest/download/SHA256SUMS";
  else url="$KUNAI_DL_BASE/download/v$VERSION/$asset"; sums="$KUNAI_DL_BASE/download/v$VERSION/SHA256SUMS"; fi

  require curl
  mkdir -p "$BIN_DIR"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  info "Downloading $asset ..."
  run curl -fsSL "$url" -o "$tmp/$asset"
  run curl -fsSL "$sums" -o "$tmp/SHA256SUMS"
  if [[ "$DRY" != 1 ]]; then
    local want got
    want="$(grep " $asset\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
    got="$(sha256sum "$tmp/$asset" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
    [[ -n "$want" && "$want" == "$got" ]] || { err "Checksum mismatch for $asset"; exit 1; }
    install -m 0755 "$tmp/$asset" "$BIN_DIR/kunai"
    [[ "$os" == darwin ]] && xattr -d com.apple.quarantine "$BIN_DIR/kunai" 2>/dev/null || true
  fi
  write_manifest binary "$VERSION" "$BIN_DIR/kunai"
  info "Installed kunai → $BIN_DIR/kunai"
  case ":$PATH:" in *":$BIN_DIR:"*) :;; *) warn "Add to PATH: export PATH=\"$BIN_DIR:\$PATH\"";; esac
}

require() { have "$1" || { err "$1 is required for this step."; exit 1; }; }

ensure_bun() { have bun || { ask "Bun is required for this method. Install from bun.sh now?" y && run bash -c 'curl -fsSL https://bun.sh/install | bash' || { err "Bun required."; exit 1; }; }; }

install_npm()    { require npm; ensure_bun; run npm install -g "$KUNAI_PACKAGE"; write_manifest npm-global "$VERSION" "$(command -v kunai || echo kunai)"; }
install_bun()    { ensure_bun; run bun install -g "$KUNAI_PACKAGE"; write_manifest bun-global "$VERSION" "$(command -v kunai || echo kunai)"; }
install_source() {
  require git; ensure_bun
  local dir="${KUNAI_INSTALL_DIR:-$HOME/.local/share/kunai}"
  run mkdir -p "$(dirname "$dir")"
  if [[ -d "$dir/.git" ]]; then run git -C "$dir" pull --ff-only; else run rm -rf "$dir"; run git clone --depth 1 "$KUNAI_REPO" "$dir"; fi
  if [[ "$DRY" != 1 ]]; then ( cd "$dir"; bun install; bun run build; bun run link:global ); fi
  write_manifest source "$VERSION" "$(command -v kunai || echo kunai)"
}

install_optional_deps() {
  local pkgs=()
  ask "Install mpv (required for playback)?" y && pkgs+=(mpv)
  ask "Install yt-dlp (offline downloads)?" n && pkgs+=(yt-dlp)
  ask "Install chafa (terminal poster previews)?" n && pkgs+=(chafa)
  ((${#pkgs[@]} == 0)) && return
  if have brew; then run brew install "${pkgs[@]}"
  elif have pacman; then run sudo pacman -S --needed --noconfirm "${pkgs[@]}"
  elif have apt-get; then run sudo apt-get update && run sudo apt-get install -y "${pkgs[@]}"
  elif have dnf; then run sudo dnf install -y "${pkgs[@]}"
  else warn "No supported package manager; install manually: ${pkgs[*]}"; fi
}

usage() { sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; }

main() {
  while [[ $# -gt 0 ]]; do case "$1" in
    --method) METHOD="$2"; shift 2;;
    --version) VERSION="$2"; shift 2;;
    --upgrade) ACTION="upgrade"; shift;;
    --uninstall) ACTION="uninstall"; shift;;
    --yes) YES=1; shift;;
    --dry-run) DRY=1; shift;;
    -h|--help) usage; exit 0;;
    *) err "Unknown option: $1"; usage; exit 1;;
  esac; done

  if [[ "$ACTION" == upgrade ]]; then have kunai && exec kunai upgrade || { err "kunai not found; install first."; exit 1; }; fi
  if [[ "$ACTION" == uninstall ]]; then exec_uninstall; return; fi

  printf '\033[1mKunai installer\033[0m\n'
  case "$METHOD" in
    binary) install_binary;;
    npm) install_npm;;
    bun) install_bun;;
    source) install_source;;
    *) err "Unknown method: $METHOD"; exit 1;;
  esac
  install_optional_deps
  printf '\033[1mDone.\033[0m  Try: kunai -S "Frieren" -a\n'
}

exec_uninstall() { # delegates to kunai when present, else removes the binary
  if have kunai; then kunai --uninstall; else rm -f "$BIN_DIR/kunai" && info "Removed $BIN_DIR/kunai"; fi
}

main "$@"
```

- [ ] **Step 2: Lint the script**

Run: `shellcheck install.sh && shfmt -d install.sh || true`
Expected: shellcheck reports no errors (warnings acceptable; fix any error-level findings).

- [ ] **Step 3: Dry-run smoke (binary + npm)**

Run: `bash install.sh --method binary --dry-run --yes` and `bash install.sh --method npm --dry-run --yes`
Expected: prints `→ [dry-run] curl … kunai-<os>-<arch>` for binary; `→ [dry-run] npm install -g @kitsunekode/kunai` for npm. No network calls executed.

- [ ] **Step 4: Commit**

```bash
git add install.sh
git commit -m "feat(install): binary-first, tty-correct, channel-aware installer"
```

---

## Task 7: Windows `install.ps1`

**Files:**

- Create: `install.ps1`

- [ ] **Step 1: Create `install.ps1`**

```powershell
#requires -version 5
# Kunai Windows installer.
#   irm https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.ps1 | iex
#   .\install.ps1 -Method binary -Version 1.2.3 -Upgrade -Uninstall -Yes -DryRun
[CmdletBinding()]
param(
  [ValidateSet("binary","npm","bun","source")] [string]$Method = "binary",
  [string]$Version = "latest",
  [switch]$Upgrade, [switch]$Uninstall, [switch]$Yes, [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$DlBase   = if ($env:KUNAI_DL_BASE) { $env:KUNAI_DL_BASE } else { "https://github.com/KitsuneKode/kunai/releases" }
$BinDir   = Join-Path $env:LOCALAPPDATA "kunai\bin"
$ConfigDir= Join-Path $env:APPDATA "kunai"

function Info($m){ Write-Host "→ $m" }
function Run($block){ if($DryRun){ Write-Host "→ [dry-run] $block" } else { & ([scriptblock]::Create($block)) } }

function Write-Manifest($channel,$ver,$bin){
  if($DryRun){ Info "[dry-run] would write manifest ($channel)"; return }
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  @{ channel=$channel; version=$ver; binPath=$bin; dlBase=$DlBase; installedAt=(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } |
    ConvertTo-Json | Set-Content -Path (Join-Path $ConfigDir "install.json") -Encoding utf8
}

function Add-UserPath($dir){
  $cur = [Environment]::GetEnvironmentVariable("Path","User")
  if($cur -notlike "*$dir*"){
    [Environment]::SetEnvironmentVariable("Path", "$cur;$dir", "User")
    Info "Added $dir to your User PATH (restart your shell to pick it up)."
  }
}

function Install-Binary {
  $asset = "kunai-windows-x64.exe"
  $base  = if($Version -eq "latest"){ "$DlBase/latest/download" } else { "$DlBase/download/v$Version" }
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $tmp = Join-Path $BinDir ".kunai-new.exe"
  Info "Downloading $asset ..."
  if(-not $DryRun){
    Invoke-WebRequest "$base/$asset" -OutFile $tmp -UseBasicParsing
    $sums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
    $want = ($sums -split "`n" | Where-Object { $_ -match "  $asset$" }) -replace "\s.*",""
    $got  = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
    if($want -ne $got){ Remove-Item $tmp -Force; throw "Checksum mismatch for $asset" }
    Unblock-File $tmp
    Move-Item -Force $tmp (Join-Path $BinDir "kunai.exe")
  }
  Add-UserPath $BinDir
  Write-Manifest "binary" $Version (Join-Path $BinDir "kunai.exe")
  Info "Installed kunai → $BinDir\kunai.exe"
}

function Ensure-Bun { if(-not (Get-Command bun -ErrorAction SilentlyContinue)){ Run 'irm https://bun.sh/install.ps1 | iex' } }

if($Upgrade){ kunai upgrade; return }
if($Uninstall){ if(Get-Command kunai -ErrorAction SilentlyContinue){ kunai --uninstall } else { Remove-Item -Force (Join-Path $BinDir "kunai.exe") -ErrorAction SilentlyContinue }; return }

switch($Method){
  "binary" { Install-Binary }
  "npm"    { Ensure-Bun; Run 'npm install -g @kitsunekode/kunai'; Write-Manifest "npm-global" $Version "kunai" }
  "bun"    { Ensure-Bun; Run 'bun install -g @kitsunekode/kunai'; Write-Manifest "bun-global" $Version "kunai" }
  "source" { Ensure-Bun; Run 'git clone --depth 1 https://github.com/KitsuneKode/kunai.git "$env:LOCALAPPDATA\kunai\src"' }
}
Write-Host "Done. Try: kunai -S `"Frieren`" -a"
```

- [ ] **Step 2: Lint with PSScriptAnalyzer (if available locally)**

Run: `pwsh -c "Invoke-ScriptAnalyzer -Path install.ps1 -Severity Error"` (skip if pwsh unavailable; CI covers it in Task 10).
Expected: no Error-severity findings.

- [ ] **Step 3: Commit**

```bash
git add install.ps1
git commit -m "feat(install): Windows PowerShell installer"
```

---

## Task 8: `uninstall.sh` + `kunai --uninstall`

**Files:**

- Create: `uninstall.sh`
- Create: `apps/cli/src/services/update/run-uninstall.ts`
- Create: `apps/cli/test/unit/run-uninstall.test.ts`
- Modify: `apps/cli/src/main.ts` (handle `--uninstall`)

- [ ] **Step 1: Write the failing test for the uninstall planner**

```ts
// apps/cli/test/unit/run-uninstall.test.ts
import { expect, test } from "bun:test";
import { planUninstall } from "@/services/update/run-uninstall";

test("npm channel plans a global npm uninstall", () => {
  const p = planUninstall({ channel: "npm-global", binPath: "/x/kunai" });
  expect(p.kind).toBe("exec");
  expect(p.command).toEqual(["npm", "uninstall", "-g", "@kitsunekode/kunai"]);
});

test("binary channel plans a file removal", () => {
  const p = planUninstall({ channel: "binary", binPath: "/x/kunai" });
  expect(p.kind).toBe("remove-file");
  expect(p.path).toBe("/x/kunai");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd apps/cli test:file test/unit/run-uninstall.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `run-uninstall.ts`**

```ts
// apps/cli/src/services/update/run-uninstall.ts
import { rm } from "node:fs/promises";

import { getKunaiPaths } from "@kunai/storage";

import type { InstallMethodKind } from "./install-method";
import { readInstallManifest } from "./install-manifest";

const PKG = "@kitsunekode/kunai";

export type UninstallPlan =
  | { kind: "exec"; command: string[] }
  | { kind: "remove-file"; path: string }
  | { kind: "manual"; message: string };

export function planUninstall(input: {
  channel: InstallMethodKind;
  binPath: string;
}): UninstallPlan {
  switch (input.channel) {
    case "npm-global":
      return { kind: "exec", command: ["npm", "uninstall", "-g", PKG] };
    case "bun-global":
      return { kind: "exec", command: ["bun", "uninstall", "-g", PKG] };
    case "binary":
      return { kind: "remove-file", path: input.binPath };
    case "source":
      return {
        kind: "manual",
        message:
          "Source checkout: run `bun run unlink:global`, then delete the checkout directory.",
      };
    default:
      return { kind: "manual", message: "Unknown install method; remove kunai manually." };
  }
}

export async function runUninstall(opts: { purge: boolean }): Promise<number> {
  const manifest = await readInstallManifest();
  const channel: InstallMethodKind = manifest?.channel ?? "unknown";
  const plan = planUninstall({ channel, binPath: manifest?.binPath ?? process.execPath });

  if (plan.kind === "manual") {
    console.log(plan.message);
  } else if (plan.kind === "exec") {
    await Bun.spawn(plan.command, { stdout: "inherit", stderr: "inherit" }).exited;
  } else {
    await rm(plan.path, { force: true });
    console.log(`Removed ${plan.path}`);
  }

  if (opts.purge) {
    const p = getKunaiPaths();
    for (const target of [p.configDir, p.dataDir, p.cacheDir]) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
    }
    console.log("Removed Kunai config, data, and cache.");
  } else {
    console.log("Left your config/history/cache in place. Re-run with --purge to remove them.");
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd apps/cli test:file test/unit/run-uninstall.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire `--uninstall` into `main.ts`**

In `runCli`, alongside the `upgrade` subcommand handling from Task 5:

```ts
if (args.uninstall) {
  const { runUninstall } = await import("./services/update/run-uninstall");
  process.exit(await runUninstall({ purge: argv.includes("--purge") }));
}
```

Add `uninstall: boolean` to `parseArgs` (default false) with a case `else if (arg === "--uninstall") { args.uninstall = true; }` and a help line under DIAGNOSTICS/PATHS.

- [ ] **Step 6: Write `uninstall.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
BIN_DIR="${KUNAI_BIN_DIR:-$HOME/.local/bin}"
if command -v kunai >/dev/null 2>&1; then exec kunai --uninstall "$@"; fi
rm -f "$BIN_DIR/kunai" && echo "Removed $BIN_DIR/kunai"
echo "Config/data left in place. Remove manually if desired: ${XDG_CONFIG_HOME:-$HOME/.config}/kunai"
```

- [ ] **Step 7: Run suite + typecheck, commit**

```bash
bun run --cwd apps/cli test:unit && bun run --cwd apps/cli typecheck
git add uninstall.sh apps/cli/src/services/update/run-uninstall.ts \
  apps/cli/test/unit/run-uninstall.test.ts apps/cli/src/main.ts
git commit -m "feat(update): channel-aware uninstall (--uninstall/--purge)"
```

---

## Task 9: Release CI — build + upload binaries (version-lockstep)

**Files:**

- Modify: `.github/workflows/release.yml` (add a `binaries` job that runs after publish)

- [ ] **Step 1: Add the `binaries` job**

Append to `.github/workflows/release.yml` under `jobs:` (after the existing `release` job). It runs only when a publish happened, builds the matrix on one runner, smoke-tests the linux binary, and uploads to the GitHub Release for the just-published tag:

```yaml
binaries:
  name: Build & upload release binaries
  needs: release
  runs-on: ubuntu-latest
  timeout-minutes: 30
  permissions:
    contents: write
  steps:
    - uses: actions/checkout@v5
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version-file: package.json
    - name: Install dependencies
      run: bun install --frozen-lockfile
    - name: Build binaries
      run: bun run build:binaries
    - name: Smoke test (linux-x64)
      run: |
        ./apps/cli/dist/bin/kunai-linux-x64 --version
        ./apps/cli/dist/bin/kunai-linux-x64 --help >/dev/null
    - name: Resolve published version
      id: ver
      run: echo "tag=v$(bun -e 'console.log(require(\"./apps/cli/package.json\").version)')" >> "$GITHUB_OUTPUT"
    - name: Upload to GitHub Release
      uses: softprops/action-gh-release@v2
      with:
        tag_name: ${{ steps.ver.outputs.tag }}
        files: |
          apps/cli/dist/bin/kunai-linux-x64
          apps/cli/dist/bin/kunai-linux-arm64
          apps/cli/dist/bin/kunai-darwin-x64
          apps/cli/dist/bin/kunai-darwin-arm64
          apps/cli/dist/bin/kunai-windows-x64.exe
          apps/cli/dist/bin/SHA256SUMS
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

> Note for the executor: confirm the changesets release job creates a GitHub Release/tag named `v<version>`. If it does not, add a tag/release-creation step before upload, or switch `action-gh-release` to `create_release: true`. Verify against the actual `changesets/action` behavior during execution.

- [ ] **Step 2: Validate the workflow YAML**

Run: `bunx --yes @action-validator/cli .github/workflows/release.yml || true` (or `actionlint` if installed).
Expected: no schema errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): build and upload cross-platform binaries per version"
```

---

## Task 10: Bundle-size flags + installer CI lint

**Files:**

- Modify: `apps/cli/scripts/build.ts` (minify the published npm bundle)
- Modify: `.github/workflows/ci.yml` (shellcheck/shfmt + binary smoke)

- [ ] **Step 1: Enable minify for the published npm bundle**

In `apps/cli/scripts/build.ts`, change `minify: false,` to honor a flag, defaulting to minified for release:

```ts
const noMinify = process.argv.includes("--no-minify");
// ... in Bun.build config:
minify: !noMinify,
```

Keep `bun run dev` (which runs `src/main.ts` directly, not the bundle) unaffected — only the published artifact shrinks.

- [ ] **Step 2: Verify the bundle still runs and is smaller**

Run: `bun run --cwd apps/cli build && ls -lh apps/cli/dist/kunai.js && bun apps/cli/dist/kunai.js --version`
Expected: prints the version; `kunai.js` is meaningfully smaller than the prior 4.2 MB.

- [ ] **Step 3: Add installer lint + binary smoke to CI**

In `.github/workflows/ci.yml`, add steps to the `checks` job:

```yaml
- name: Lint installer scripts
  run: |
    sudo apt-get update && sudo apt-get install -y shellcheck
    shellcheck install.sh uninstall.sh
- name: Build binaries (linux smoke)
  run: |
    bun run build:binaries
    ./apps/cli/dist/bin/kunai-linux-x64 --version
```

- [ ] **Step 4: Run the affected checks locally**

Run: `shellcheck install.sh uninstall.sh && bun run --cwd apps/cli build:binaries && ./apps/cli/dist/bin/kunai-linux-x64 --version`
Expected: shellcheck clean (no errors), binary prints version.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/scripts/build.ts .github/workflows/ci.yml
git commit -m "build,ci: minify published bundle + lint installers + binary smoke"
```

---

## Task 11: Issue template + README install rewrite

**Files:**

- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `README.md` (Install section)

- [ ] **Step 1: Add install-method / version / OS fields to the bug template**

In `.github/ISSUE_TEMPLATE/bug_report.yml`, add these fields (follow the file's existing `body:` item style — `type: dropdown`/`input`):

```yaml
- type: dropdown
  id: install-method
  attributes:
    label: Install method
    options: [Binary (installer), npm global, bun global, Source checkout, Not sure]
  validations: { required: true }
- type: input
  id: kunai-version
  attributes:
    label: kunai --version output
    placeholder: e.g. 0.3.0
  validations: { required: true }
- type: input
  id: os-arch
  attributes:
    label: OS and architecture
    placeholder: e.g. macOS 14 arm64, Windows 11 x64, Arch Linux x64
  validations: { required: true }
```

- [ ] **Step 2: Rewrite the README Install section (binary-first)**

Replace the Install code block in `README.md` (lines ~14-55) so the zero-prereq binary is primary and npm/source are alternatives:

````markdown
### Install

```bash
# Recommended — zero prerequisites (downloads a self-contained binary)
curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.ps1 | iex

# Inspect first, pin a version, or choose a channel
… install.sh | bash -s -- --dry-run
… install.sh | bash -s -- --version 0.3.0
… install.sh | bash -s -- --method npm     # for Bun users / developers
```
````

Update any time with `kunai upgrade`; remove with `kunai --uninstall`.

> **Alternatives for developers / Bun users** (require Bun ≥ 1.3.9 at runtime):
> `npm i -g @kitsunekode/kunai` · `bun i -g @kitsunekode/kunai` · or clone + `bun install && bun run link:global`.

````

- [ ] **Step 3: Verify templates parse**

Run: `bunx --yes js-yaml .github/ISSUE_TEMPLATE/bug_report.yml >/dev/null && echo "yaml ok"`
Expected: `yaml ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/ISSUE_TEMPLATE/bug_report.yml README.md
git commit -m "docs: binary-first install + richer bug template fields"
````

---

## Final verification (run after all tasks)

- [ ] `bun run typecheck` — no errors.
- [ ] `bun run lint` — clean.
- [ ] `bun run test` — all unit/integration pass.
- [ ] `bun run --cwd apps/cli build:binaries && ./apps/cli/dist/bin/kunai-linux-x64 --version` — binary runs.
- [ ] `shellcheck install.sh uninstall.sh` — no errors.
- [ ] `bash install.sh --method binary --dry-run --yes` — prints intended actions, no side effects.
- [ ] Manual matrix (best-effort): run the linux binary; on macOS verify quarantine strip; on Windows verify install.ps1 + `kunai upgrade` rename-self path on a published prerelease.

---

## Notes for the executor

- **DRY:** reuse `detectInstallMethod`/`updateGuidanceForInstallMethod` as the heuristic fallback; the manifest is authoritative when present.
- **Do not** add a banner shebang in any compile step — `src/main.ts` already has `#!/usr/bin/env bun`.
- **`@kunai/providers` must not import the CLI app** — keep the WASM seam inside the providers package (Task 1 Step 5).
- **Checksum failures abort.** Never install unverified bytes.
- **macOS/Windows signing** is intentionally out of scope; the documented `xattr`/`Unblock-File`/SmartScreen steps are the v1 story, with a clean hook left in CI for future notarization.
