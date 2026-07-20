# Installer Safety and Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop destructive and false-success installs by separating source/runtime paths, aligning macOS paths, reporting the actual PATH winner, preserving package-manager ownership, and making installer scenarios a blocking CI gate.

**Architecture:** Keep `install.sh` and `install.ps1` self-contained, but align them with runtime path and ownership contracts. Put reusable TypeScript PATH/provenance logic in pure modules, and verify shell behavior with isolated subprocess and Docker scenarios.

**Tech Stack:** Bun, TypeScript, Bash, PowerShell 5+, Docker, GitHub Actions.

## Global Constraints

- Release target is `0.3.0`.
- Linux glibc and musl are supported; macOS and Windows are beta.
- Native install may coexist with npm, Bun, and source installs.
- Native install never silently removes another channel.
- Source checkout never overlaps runtime data/config/cache.
- macOS defaults match `packages/storage/src/paths.ts`.
- Windows candidate resolution honors `.COM;.EXE;.BAT;.CMD` order.
- Preserve `scripts/generate-release-notes.ts` and never stage `docs/installer-reference/`.
- Use exact path staging and `bun run` commands only.

---

### Task 1: Separate source checkout from runtime data

**Files:**

- Modify: `install.sh:17-24`
- Modify: `install.sh:345-362`
- Create: `test/install/scenarios/source-data-separation.sh`

**Interfaces:**

- Consumes: `KUNAI_SOURCE_DIR`, legacy `KUNAI_INSTALL_DIR`, `KUNAI_DATA_DIR`, `KUNAI_CONFIG_DIR`
- Produces: `SOURCE_DIR` dedicated to the checkout; runtime `DATA_DIR` remains unchanged

- [ ] **Step 1: Write the failing scenario**

Create `test/install/scenarios/source-data-separation.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

failures=0
pass() { printf '  PASS %s\n' "$1"; }
fail() { printf '  FAIL %s\n       %s\n' "$1" "${2:-}"; failures=$((failures + 1)); }

export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CONFIG_HOME="$HOME/.config"
export KUNAI_SOURCE_DIR="$HOME/.local/src/kunai"
export KUNAI_CONFIG_DIR="$XDG_CONFIG_HOME/kunai"

data_dir="$XDG_DATA_HOME/kunai"
source_dir="$KUNAI_SOURCE_DIR"
seed="$data_dir/seeded-history.txt"
shim_dir="$HOME/test-bin"
mkdir -p "$data_dir" "$shim_dir"
printf 'preserve-me\n' >"$seed"

cat >"$shim_dir/git" <<'SHIM'
#!/bin/sh
target=""
for argument in "$@"; do target="$argument"; done
if [ "$1" = "clone" ]; then
  mkdir -p "$target/.git"
  printf 'source checkout\n' >"$target/README.fixture"
  exit 0
fi
[ "$1" = "-C" ] && exit 0
exit 1
SHIM
chmod 0755 "$shim_dir/git"
printf '#!/bin/sh\nexit 0\n' >"$shim_dir/bun"
chmod 0755 "$shim_dir/bun"
export PATH="$shim_dir:$PATH"

/harness/install.sh --method source --version 0.3.0 --yes --skip-deps

[[ -f "$seed" && "$(cat "$seed")" == "preserve-me" ]] \
  && pass "seeded runtime data survived" \
  || fail "source install deleted runtime data" "$seed"
[[ -d "$source_dir/.git" ]] \
  && pass "source checkout used KUNAI_SOURCE_DIR" \
  || fail "source checkout missing" "$source_dir"
[[ "$source_dir" != "$data_dir" ]] \
  && pass "source and data paths differ" \
  || fail "source and data paths overlap" "$source_dir"

(( failures == 0 ))
```

- [ ] **Step 2: Verify the current failure**

```bash
bash test/install/run.sh source-data-separation
```

Expected: scenario fails because current source installation can remove the runtime data directory.

- [ ] **Step 3: Introduce the dedicated source path**

At the top of `install.sh` use:

```bash
SOURCE_DIR="${KUNAI_SOURCE_DIR:-${KUNAI_INSTALL_DIR:-$HOME/.local/src/kunai}}"
CONFIG_DIR="${KUNAI_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kunai}"
DATA_DIR="${KUNAI_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/kunai}"
CACHE_DIR="${KUNAI_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/kunai}"
```

- [ ] **Step 4: Refuse occupied non-checkout paths**

Replace source installation logic with:

```bash
if [[ "$SOURCE_DIR" == "$DATA_DIR" || "$SOURCE_DIR" == "$CONFIG_DIR" ]]; then
  err "Source checkout path must not equal Kunai data or config paths."
  exit 1
fi

if [[ -d "$SOURCE_DIR/.git" ]]; then
  run git -C "$SOURCE_DIR" pull --ff-only
elif [[ -e "$SOURCE_DIR" ]]; then
  err "Refusing to replace existing non-checkout path: $SOURCE_DIR"
  exit 1
else
  run mkdir -p "$(dirname "$SOURCE_DIR")"
  run git clone --depth 1 "$KUNAI_REPO" "$SOURCE_DIR"
fi
```

No recursive deletion is permitted.

- [ ] **Step 5: Run both root scenarios**

```bash
bash test/install/run.sh source-data-separation
bash test/install/run.sh npm-contamination
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add install.sh test/install/scenarios/source-data-separation.sh
git status --short
git commit -m "fix(install): separate source checkout from runtime data"
```

### Task 2: Align macOS bootstrap paths with runtime paths

**Files:**

- Modify: `install.sh:17-24`
- Modify: `apps/cli/test/integration/helpers/installer-script-harness.ts`
- Modify: `apps/cli/test/integration/install-scripts.test.ts`

**Interfaces:**

- Consumes: `getKunaiPaths({ platform: "darwin" })`
- Produces: shell defaults matching macOS `Application Support` and `Caches`

- [ ] **Step 1: Add environment helpers**

Add:

```ts
export function withoutKunaiPathOverrides(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of [
    "KUNAI_BIN_DIR",
    "KUNAI_CONFIG_DIR",
    "KUNAI_DATA_DIR",
    "KUNAI_CACHE_DIR",
    "KUNAI_SOURCE_DIR",
    "KUNAI_INSTALL_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
  ])
    delete env[key];
  return env;
}
```

- [ ] **Step 2: Add the failing Darwin dry-run test**

Extend `installCommandShim()` to accept custom contents, then shadow `uname` through PATH:

```ts
test("macOS defaults match runtime paths", () => {
  const sandbox = createInstallerSandbox("install-sh-darwin-paths");
  const shimDir = join(sandbox.root, "shims");
  mkdirSync(shimDir, { recursive: true });
  installCommandShim(
    shimDir,
    "uname",
    '#!/bin/sh\nif [ "$1" = "-s" ]; then echo Darwin; else echo arm64; fi\n',
  );

  const runtimePaths = getKunaiPaths({
    platform: "darwin",
    homeDir: sandbox.root,
    env: { TMPDIR: join(sandbox.root, "tmp") },
  });
  const env = withoutKunaiPathOverrides();
  env.HOME = sandbox.root;
  env.PATH = `${shimDir}${delimiter}${env.PATH ?? ""}`;

  const result = runInstallSh(["--dry-run", "--yes", "--skip-deps", "--version", "9.8.7"], env);

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`${runtimePaths.dataDir}/versions/9.8.7/kunai`);
  expect(result.stdout).toContain(`${runtimePaths.configDir}/install.json`);
});
```

- [ ] **Step 3: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/integration/install-scripts.test.ts
```

Expected: Darwin test reports `.local/share/kunai` instead of `Library/Application Support/kunai`.

- [ ] **Step 4: Select defaults by host OS**

```bash
case "$(uname -s)" in
  Darwin) HOST_OS="darwin" ;;
  Linux) HOST_OS="linux" ;;
  *) HOST_OS="unknown" ;;
esac

if [[ "$HOST_OS" == "darwin" ]]; then
  CONFIG_DIR="${KUNAI_CONFIG_DIR:-$HOME/Library/Application Support/kunai}"
  DATA_DIR="${KUNAI_DATA_DIR:-$HOME/Library/Application Support/kunai}"
  CACHE_DIR="${KUNAI_CACHE_DIR:-$HOME/Library/Caches/kunai}"
else
  CONFIG_DIR="${KUNAI_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/kunai}"
  DATA_DIR="${KUNAI_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/kunai}"
  CACHE_DIR="${KUNAI_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/kunai}"
fi
```

- [ ] **Step 5: Run tests**

```bash
bun run --cwd apps/cli test:file -- test/integration/install-scripts.test.ts
bun run --cwd packages/storage test
bash test/install/run.sh source-data-separation
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add install.sh \
  apps/cli/test/integration/helpers/installer-script-harness.ts \
  apps/cli/test/integration/install-scripts.test.ts
git commit -m "fix(install): align macOS bootstrap paths with runtime"
```

### Task 3: Add cross-platform PATH candidate detection

**Files:**

- Create: `apps/cli/src/services/update/path-candidates.ts`
- Create: `apps/cli/test/unit/services/update/path-candidates.test.ts`
- Modify: `apps/cli/src/services/update/install-method.ts`
- Modify: `apps/cli/test/unit/services/update/install-method.test.ts`
- Modify: `apps/cli/src/services/update/native-installer/install-diagnostic.ts`
- Create: `apps/cli/test/unit/services/update/native-installer/install-diagnostic.test.ts`

**Interfaces:**

```ts
export interface KunaiPathCandidate {
  readonly path: string;
  readonly directory: string;
  readonly rank: number;
  readonly extension: string;
}

export function findKunaiPathCandidates(input: {
  readonly pathValue: string;
  readonly platform: NodeJS.Platform;
  readonly pathExt?: string;
  readonly fileExists: (path: string) => boolean;
}): readonly KunaiPathCandidate[];
```

- [ ] **Step 1: Write POSIX and Windows order tests**

```ts
test("preserves POSIX PATH order", () => {
  const existing = new Set(["/opt/npm/bin/kunai", "/home/k/.local/bin/kunai"]);
  expect(
    findKunaiPathCandidates({
      pathValue: "/opt/npm/bin:/home/k/.local/bin",
      platform: "linux",
      fileExists: (path) => existing.has(path),
    }).map((item) => item.path),
  ).toEqual(["/opt/npm/bin/kunai", "/home/k/.local/bin/kunai"]);
});

test("uses Windows PATHEXT order", () => {
  const existing = new Set([
    "C:\\Users\\k\\AppData\\Roaming\\npm\\kunai.cmd",
    "C:\\Users\\k\\AppData\\Local\\kunai\\bin\\kunai.exe",
  ]);
  expect(
    findKunaiPathCandidates({
      pathValue: "C:\\Users\\k\\AppData\\Roaming\\npm;C:\\Users\\k\\AppData\\Local\\kunai\\bin",
      pathExt: ".COM;.EXE;.BAT;.CMD",
      platform: "win32",
      fileExists: (path) => existing.has(path),
    }).map((item) => item.path),
  ).toEqual([...existing]);
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/unit/services/update/path-candidates.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement the resolver**

Use `posix` and `win32` from `node:path`; ignore empty entries, preserve directory order, and de-duplicate case-insensitively on Windows.

- [ ] **Step 4: Make install-method detection platform-aware**

Extend its input with:

```ts
readonly platform?: NodeJS.Platform;
readonly fileExists?: (path: string) => boolean;
```

Normalize entrypoints to `/` before checking Bun/npm path fragments, and test Windows npm, Bun, and source paths.

- [ ] **Step 5: Add structured diagnostics**

Add diagnostic codes:

```text
path-winner
multiple-path-binaries
launcher-shadowed
```

Inject `pathValue`, `pathExt`, `platform`, `fileExists`, and `readManifest` into `getInstallDiagnostics()` for deterministic tests.

- [ ] **Step 6: Run focused tests**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/path-candidates.test.ts \
  test/unit/services/update/install-method.test.ts \
  test/unit/services/update/native-installer/install-diagnostic.test.ts
bun run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/services/update/path-candidates.ts \
  apps/cli/src/services/update/install-method.ts \
  apps/cli/src/services/update/native-installer/install-diagnostic.ts \
  apps/cli/test/unit/services/update/path-candidates.test.ts \
  apps/cli/test/unit/services/update/install-method.test.ts \
  apps/cli/test/unit/services/update/native-installer/install-diagnostic.test.ts
git commit -m "fix(update): detect install provenance and PATH winners"
```

### Task 4: Report the PowerShell PATH winner

**Files:**

- Modify: `install.ps1`
- Modify: `apps/cli/test/integration/install-scripts-pwsh.test.ts`

**Interfaces:**

```powershell
function Get-KunaiPathCandidates { [OutputType([string[]])] param() }
function Write-KunaiPathDiagnostic { param([string]$InstalledPath) }
```

- [ ] **Step 1: Add a Windows-only stale npm shim test**

Assert output contains `PATH winner:`, the npm shim path, the planned native path, and `npm uninstall -g @kitsunekode/kunai` as guidance.

- [ ] **Step 2: Verify the failure on Windows**

```bash
bun run --cwd apps/cli test:file -- test/integration/install-scripts-pwsh.test.ts
```

Expected: no PATH winner message.

- [ ] **Step 3: Implement candidate enumeration**

Split `$env:Path` on `;`, try PATHEXT entries, canonicalize full paths, and preserve order. Do not remove or reorder candidates.

- [ ] **Step 4: Report but do not mutate**

After manifest writing, print the winner. If it differs from `$BinPath`, print package-manager or PATH remediation and instruct the user to reopen the shell and run `Get-Command kunai -All`.

- [ ] **Step 5: Run tests and commit**

```bash
bun run --cwd apps/cli test:file -- test/integration/install-scripts-pwsh.test.ts
git add install.ps1 apps/cli/test/integration/install-scripts-pwsh.test.ts
git commit -m "fix(install): report the Windows PATH winner"
```

### Task 5: Remove silent npm cleanup from native install

**Files:**

- Modify: `apps/cli/src/services/update/run-install.ts`
- Modify: `apps/cli/src/services/update/native-installer/index.ts`
- Delete: `apps/cli/src/services/update/native-installer/cleanup-npm.ts`
- Create: `apps/cli/test/unit/services/update/run-install-ownership.test.ts`

- [ ] **Step 1: Add a non-executing architecture guard**

```ts
test("native install has no package-manager cleanup side effect", async () => {
  const source = await Bun.file(join(UPDATE_ROOT, "run-install.ts")).text();
  expect(source).not.toContain("cleanupNpmInstallations");
  expect(source).not.toMatch(/\b(?:npm|bun)\b.*\b(?:uninstall|remove)\b/);
});
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/unit/services/update/run-install-ownership.test.ts
```

Expected: cleanup call is found.

- [ ] **Step 3: Remove cleanup and print all diagnostics**

After installation:

```ts
for (const diagnostic of await getInstallDiagnostics()) {
  const output =
    diagnostic.level === "error"
      ? console.error
      : diagnostic.level === "warn"
        ? console.warn
        : console.log;
  output(diagnostic.message);
}
```

- [ ] **Step 4: Run focused regressions**

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/run-install-ownership.test.ts \
  test/unit/services/update/native-installer/install-diagnostic.test.ts \
  test/unit/run-uninstall.test.ts \
  test/unit/upgrade-planner.test.ts
bash test/install/run.sh npm-contamination
```

Expected: all pass; npm shim remains installed.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/services/update/run-install.ts \
  apps/cli/src/services/update/native-installer/index.ts \
  apps/cli/test/unit/services/update/run-install-ownership.test.ts
git add -u apps/cli/src/services/update/native-installer/cleanup-npm.ts
git commit -m "fix(install): preserve package-manager-owned installs"
```

### Task 6: Always report the Unix PATH winner

**Files:**

- Modify: `install.sh:257-307`
- Modify: `apps/cli/test/integration/install-scripts.test.ts`

- [ ] **Step 1: Assert exact winner in the successful fixture test**

```ts
expect(result.stdout).toContain(`PATH winner: ${join(sandbox.binDir, "kunai")}`);
```

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/cli test:file -- test/integration/install-scripts.test.ts
```

Expected: current output only says the directory is on PATH.

- [ ] **Step 3: Replace warning-only behavior**

Rename `warn_conflicting_installs` to `report_path_winner`; always print `command -v kunai`, return quietly when it equals the managed launcher, and otherwise print existing non-destructive remediation.

- [ ] **Step 4: Run and commit**

```bash
bun run --cwd apps/cli test:file -- test/integration/install-scripts.test.ts
bun run test:installer:scenarios
git add install.sh apps/cli/test/integration/install-scripts.test.ts
git commit -m "fix(install): identify the Unix PATH winner"
```

### Task 7: Wire ownership scenarios into blocking CI

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `test/install/README.md`

- [ ] **Step 1: Add the root command**

```json
"test:installer:scenarios": "bash test/install/run.sh"
```

- [ ] **Step 2: Verify it runs**

```bash
bun run test:installer:scenarios
```

Expected: `npm-contamination` and `source-data-separation` pass.

- [ ] **Step 3: Expand installer path filters**

Add `test/install/**` and root `package.json` to the installer filter.

- [ ] **Step 4: Add a blocking Ubuntu job**

```yaml
installer-scenarios:
  name: Installer ownership scenarios
  needs: changes
  if: needs.changes.outputs.installer == 'true'
  runs-on: ubuntu-latest
  timeout-minutes: 15
  steps:
    - uses: actions/checkout@v5
    - uses: ./.github/actions/setup-bun-monorepo
      with:
        turbo-cache-prefix: installer-scenarios
    - name: Run hermetic installer scenarios
      run: bun run test:installer:scenarios
```

Do not replace the compiled Linux installer Docker job.

- [ ] **Step 5: Run CI contract tests**

```bash
bun run --cwd apps/cli test:file -- test/unit/scripts/ci-bootstrap-contract.test.ts
bun run test:installer:scenarios
```

- [ ] **Step 6: Commit**

```bash
git add package.json .github/workflows/ci.yml test/install/README.md
git commit -m "ci(installer): run ownership scenarios as a blocking gate"
```

## Slice Verification

```bash
bun run --cwd apps/cli test:file -- \
  test/unit/services/update/path-candidates.test.ts \
  test/unit/services/update/install-method.test.ts \
  test/unit/services/update/native-installer/install-diagnostic.test.ts \
  test/unit/services/update/run-install-ownership.test.ts \
  test/integration/install-scripts.test.ts \
  test/integration/install-scripts-pwsh.test.ts
bun run test:installer:scenarios
bun run typecheck
bun run lint
bun run fmt
bun run test
bun run build
bun run pkg:check
```

Expected: every command passes; only the pre-existing unrelated files remain in `git status --short`.
