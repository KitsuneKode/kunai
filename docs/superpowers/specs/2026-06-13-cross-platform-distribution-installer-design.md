# Cross-Platform Distribution & Installer — Design (Spec A)

- **Status:** Draft for review
- **Date:** 2026-06-13
- **Owner:** kitsunekode
- **Scope:** Distribution model, installer scripts, upgrade/uninstall, build/bundle, release CI, installer-facing repo infra.
- **Out of scope (separate spec — Spec B):** Surgical Bun/Node API audit (`randomUUID` standardization, `findFreePort`/OAuth-loopback `Bun.serve` migration). Tracked separately so runtime-code churn never blocks shipping the installer.

---

## 1. Problem & Goals

### Problem

Today every install channel requires **Bun at runtime** because the published binary is `dist/kunai.js` with a `#!/usr/bin/env bun` shebang. The worst path is `npm install -g`, which needs **both** Node (for npm) and Bun (for the runtime). The interactive `install.sh` is also broken under its own advertised `curl … | bash` usage (prompts read from the script pipe, not the terminal), has no upgrade/uninstall story, and has no Windows path.

### Goals

1. **Zero-prerequisite default install** via self-contained compiled binaries that embed the Bun runtime (Bun-only APIs keep working).
2. **Three coherent channels** — binary (default), npm, bun, source — that all produce the same working `kunai`, record how they were installed, and route `upgrade`/`uninstall` correctly per channel. No channel ever stomps another.
3. **True cross-platform self-update** on Linux, macOS, **and** Windows from v1.
4. **Long-term durability:** a frozen asset-naming contract + a single swappable download-base so the installer written once keeps working for every future release, and hosting can move (GitHub Releases → Cloudflare R2) without touching logic.
5. Fix `install.sh` correctness (tty, PATH hints), add Windows `install.ps1`, smaller bundles, and installer-facing CI/templates.

### Non-goals (deliberate future work)

- Code signing / Apple notarization / Windows Authenticode (documented workarounds for v1).
- AUR / Homebrew tap / Chocolatey / Scoop manifests (the binary contract is designed to make these trivial later, but they are not built now).
- Cloudflare R2 hosting (the design makes it a one-constant flip; not provisioned now).

---

## 2. Durable Contracts (the long-term backbone)

These three contracts are frozen now and are what make the system survive all future updates without rework.

### 2.1 Asset naming contract

Every release publishes exactly these asset names:

```
kunai-linux-x64
kunai-linux-arm64
kunai-darwin-x64
kunai-darwin-arm64
kunai-windows-x64.exe
SHA256SUMS                # one line per binary: "<sha256>  <filename>"
```

`install.sh`, `install.ps1`, and `kunai upgrade` are written **against these names, not against any version number**. As long as future releases keep emitting these names, the install/upgrade paths keep working unchanged for v0.3 … v1.0 … v5.0.

### 2.2 Download-base contract

A single constant `KUNAI_DL_BASE` (env-overridable) is the only place hosting is expressed:

- Default: `https://github.com/KitsuneKode/kunai/releases` (resolved as `…/releases/download/v<version>/<asset>` for pinned, `…/releases/latest/download/<asset>` for latest).
- Future R2: set `KUNAI_DL_BASE=https://dl.kunai.sh` and emit the same asset names there. No logic changes anywhere.

### 2.3 Version-lockstep contract

The release CI publishes the **npm package and the binaries for the same changeset version in the same run**. There is never version skew between channels. "Latest version" therefore has a single source of truth, and `kunai upgrade` on any channel resolves to the same target.

---

## 3. Component Design

Each component is independently testable with a stated interface and dependencies.

### 3.1 Runtime asset resolution (`resolveRuntimeAsset`)

**The only component that touches runtime code.** Today `build.ts` copies `module1_patched.wasm` (VidKing) and `kunai-bridge.lua` (mpv) next to `dist/kunai.js` and the runtime resolves them by path relative to the bundle. A single-file compiled binary has no sibling `assets/` dir, so this breaks.

- **What it does:** returns an absolute filesystem path for a named runtime asset, valid in dev (repo source files), npm (bundle-adjacent `dist/assets/…`), and compiled-binary modes.
- **Interface:** `resolveRuntimeAsset(name: "vidking-wasm" | "mpv-lua"): Promise<string>` → absolute path.
- **How:** assets are embedded via Bun's `import asset from "./…" with { type: "file" }`. On first call in binary mode, the asset bytes are extracted **once** to `<cacheDir>/kunai/assets/<version>/<name>` (versioned so upgrades re-extract). The function returns that path. In dev/npm mode it returns the existing repo/bundle path. mpv needs a real file path for the Lua bridge; the WASM loader needs a real path too — both get one.
- **Depends on:** OS cache dir resolution (already used by the cache SQLite), `node:fs` atomic write (temp-in-dir + rename, per CLAUDE.md fs guidance).
- **Failure mode:** if extraction fails (permissions, disk), throw a clear, actionable error **before** launching mpv — never a half-initialized playback path.
- **Callers updated:** the VidKing WASM loader and the mpv launch path switch from hardcoded `dist/assets/…` to `resolveRuntimeAsset(...)`.

### 3.2 Binary build (`scripts/build-binaries.ts`)

- **What it does:** cross-compiles all 5 targets from one host and emits `SHA256SUMS`.
- **Command per target:** `bun build src/main.ts --compile --minify --bytecode --target=bun-<target> --outfile dist/bin/kunai-<target>`.
- **Why one host:** Bun cross-compiles every target from a single Linux runner; no per-OS runner matrix needed for building (a native smoke run is still done — see 3.7).
- **Flags rationale:** `--minify` (smaller), `--bytecode` (smaller + faster cold start). Embedded assets (3.1) are bundled by the compiler via the `with { type: "file" }` imports.
- **Output:** `dist/bin/kunai-<target>` + `dist/bin/SHA256SUMS`.

### 3.3 Install manifest (channel awareness)

- **What it does:** records how this install happened so upgrade/uninstall route correctly and never fight another channel.
- **Location:** the app's existing OS-resolved **config dir** (Linux `~/.config/kunai`, macOS `~/Library/Application Support/kunai` or the app's current config resolver, Windows `%APPDATA%\kunai`), file `install.json`. Uses the app's existing config-dir helper — never a hardcoded `~/.config`.
- **Shape:** `{ "channel": "binary" | "npm" | "bun" | "source", "version": string, "binPath": string, "dlBase": string, "installedAt": ISO8601 }`.
- **Writers:** `install.sh`/`install.ps1` (binary), a tiny `postinstall` in `apps/cli/package.json` (npm/bun), `link:global` (source).
- **Readers:** `kunai upgrade`, `kunai --uninstall`, diagnostics, `kunai --version` (shows channel).
- **Fallback when manifest absent (older installs):** heuristic channel detection from the running executable's location/shape — compiled binary (single-file, not `bun`/`node`) → `binary`; path under a global `node_modules/.bin` → `npm`/`bun`; path inside a git checkout → `source`. The heuristic only ever _suggests_; it then writes a manifest so the next run is deterministic.

### 3.4 `kunai upgrade` (channel-aware self-update subcommand)

- **What it does:** brings the current install to the latest released version using the **correct** mechanism for its channel.
- **Flow:** read manifest (or heuristic) → resolve latest version (GitHub "latest release" API; npm dist-tag is equivalent by the lockstep contract) → compare to `kunai --version` → if newer, act per channel:
  - **binary:** download `kunai-<os>-<arch>` + verify against `SHA256SUMS` → atomic self-replace (see 3.5) → done.
  - **npm:** run `npm i -g @kitsunekode/kunai@latest`.
  - **bun:** run `bun i -g @kitsunekode/kunai@latest`.
  - **source:** `git -C <repo> pull --ff-only && bun install && bun run build && bun run relink:global`.
- **Flags:** `--check` (report only), `--version X.Y.Z` (pin), `--force`.
- **Output:** identical UX regardless of channel — the user never needs to know the underlying mechanism.

### 3.5 Atomic self-replace (per-OS)

- **Interface:** `replaceSelf(newBinaryPath: string, currentBinaryPath: string): Promise<void>`.
- **Linux/macOS:** download to a temp file **in the same directory** as the current binary → verify checksum → `chmod 0755` → `rename()` over the current path. Renaming over a running binary's inode is safe; the running process keeps the old inode, the next launch is new.
- **Windows (rename-self dance):** download to a same-directory temp → verify → `Move` running `kunai.exe` → `kunai.exe.old` → `Move` new exe into `kunai.exe`. The running process keeps executing from the moved-aside file. Retry the moves with short backoff to absorb AV/Defender locks.
- **Windows `.old` cleanup:** on **every** `kunai` launch, delete any stale `*.old` next to the executable (can't delete while still mapped; succeeds on next run). Self-healing.
- **Same-volume rule:** temp file always co-located with the target so the final move is an atomic same-volume rename, never a cross-volume copy.

### 3.6 Installer scripts

#### `install.sh` (bash, `/dev/tty`-correct)

- **Default path = binary:** `detect_os` + `detect_arch` → download `kunai-<os>-<arch>` from `KUNAI_DL_BASE` → verify SHA256 against `SHA256SUMS` → install to `${KUNAI_BIN_DIR:-$HOME/.local/bin}/kunai` → `chmod 0755` → write manifest → PATH check → optional deps.
- **tty fix:** all prompts read from `/dev/tty`. If no tty (`[ -t 0 ]` false and `/dev/tty` unavailable) → non-interactive mode with safe defaults. This makes the README `curl … | bash` command actually interactive.
- **PATH hint fix:** report the correct bin dir for the chosen method (binary → `$KUNAI_BIN_DIR`; npm/bun → the resolved global bin dir; not a hardcoded `~/.local/bin` for all).
- **macOS quarantine:** after install, `xattr -d com.apple.quarantine` on the binary with a one-line explanation.
- **Flags:** `--method binary|npm|bun|source` (default `binary`), `--version X.Y.Z`, `--upgrade`, `--uninstall`, `--yes` (non-interactive), `--dry-run`.
- **Fallbacks preserved:** npm/bun/source flows stay as today (they still ensure Bun where required), now also writing the manifest.

#### `install.ps1` (Windows, parity)

- Detect arch → download `kunai-windows-x64.exe` → verify SHA256 → `Unblock-File` (clear Mark-of-the-Web) → install to `%LOCALAPPDATA%\kunai\bin\kunai.exe` → add that dir to **User** PATH via registry → broadcast `WM_SETTINGCHANGE` → write manifest → optional `winget`/`scoop` prompt for mpv.
- Flags mirror `install.sh`: `-Method`, `-Version`, `-Upgrade`, `-Uninstall`, `-Yes`, `-DryRun`.

#### `uninstall.sh` / `kunai --uninstall`

- Read manifest → undo the **matching** channel: binary → delete binary + manifest; npm/bun → `… uninstall -g @kitsunekode/kunai`; source → `unlink:global`.
- **Prompt** before deleting user data (`<configDir>/kunai`, data/cache SQLite, `logs.txt`). Never wipe data silently. `--purge`/`-Purge` to skip the prompt and remove data too.

### 3.7 Release CI (`release-binaries` job)

- **Trigger:** after the changesets publish step tags a new version (job gated on the publish/`release: published`), so npm + binaries ship together (lockstep contract).
- **Steps:** checkout → `setup-bun` → `bun install --frozen-lockfile` → `bun run build:binaries` → run the freshly built **linux-x64** binary's `kunai --version` as a smoke check → upload the 5 binaries + `SHA256SUMS` to the GitHub Release (`softprops/action-gh-release` or `gh release upload`).
- Existing `release.yml` npm publish is unchanged; this is an added job in the same workflow.

### 3.8 Bundle size

- **Binary:** `--minify --bytecode` (3.2).
- **npm `dist/kunai.js`:** enable `minify` for the **published** build (currently `minify: false`, 4.2 MB). Keep an unminified dev build behind a `--dev`/no-minify flag for readable stack traces. Smaller tarball also benefits a future AUR/Chocolatey package.

### 3.9 Repo infra (installer-facing only)

- `bug_report.yml`: add **Install method** (dropdown: binary / npm / bun / source), **`kunai --version`** output, and **OS/arch** fields — needed now that there are multiple channels.
- CI: add `shellcheck install.sh` + `shfmt --diff install.sh`; lint `install.ps1` with `PSScriptAnalyzer`; add a job step that runs the compiled linux binary `--version`.
- README install section: lead with the zero-prereq binary one-liner; demote npm/source to "alternatives for developers / Bun users."

---

## 4. User-facing surface

```sh
# Default — zero prerequisites
curl -fsSL https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.sh | bash
# Windows
irm https://raw.githubusercontent.com/KitsuneKode/kunai/main/install.ps1 | iex

# Inspect first / pin / pick a channel
… install.sh | bash -s -- --dry-run
… install.sh | bash -s -- --version 0.3.0
… install.sh | bash -s -- --method npm

# Lifecycle (identical UX on every channel/OS)
kunai upgrade            # channel-aware self-update
kunai upgrade --check    # report only
kunai --uninstall        # channel-aware removal, prompts before data wipe
```

Developers/Bun users keep `npm i -g @kitsunekode/kunai`, `bun i -g …`, and the source `git clone && bun install && bun run link:global` flows verbatim.

---

## 5. Error Handling

- **Checksum mismatch:** abort with the expected vs actual hash; never install unverified bytes.
- **Network/asset 404:** clear message + suggest `--method npm` as a fallback.
- **Unsupported arch/OS:** explain and point to the source-install path.
- **Asset extraction failure (3.1):** hard, explained error before mpv launch.
- **Self-replace lock (Windows):** retry with backoff, then fail clean leaving the working old binary in place (never a half-replaced state).
- **Missing tty + interactive needed:** fall back to non-interactive defaults rather than hanging or reading the pipe.

---

## 6. Testing

- `install.sh --dry-run` golden-output test; `shellcheck`/`shfmt` clean in CI.
- `install.ps1` `-DryRun` path; `PSScriptAnalyzer` clean.
- Unit: `resolveRuntimeAsset` (dev vs binary extraction), manifest read/write + heuristic fallback, checksum verification, `replaceSelf` per-OS (mockable fs seams).
- CI smoke: compiled linux binary runs `kunai --version` (and exercises `resolveRuntimeAsset` by touching an asset path) before release upload.
- Channel-routing test: `kunai upgrade` dispatches the correct command per manifest channel (no live network — assert the chosen action).

---

## 7. Phasing (implementation order)

1. **Asset embedding** (`resolveRuntimeAsset` + caller updates) — unblocks a working compiled binary. Highest-risk, do first.
2. **`build-binaries.ts`** + local 5-target build + checksums.
3. **Manifest** read/write + heuristic fallback + `--version` shows channel.
4. **`install.sh` rewrite** (binary default, tty fix, flags, manifest, macOS quarantine).
5. **`kunai upgrade`** + `replaceSelf` (Linux/macOS first, then Windows rename-self in the same slice) + `uninstall`.
6. **`install.ps1`**.
7. **Release CI** `release-binaries` job + version-lockstep.
8. **Bundle-size flags** + **repo infra** (templates, shellcheck, README).

---

## 8. Risks (acknowledged)

1. **Asset embedding** is the real engineering; it touches runtime asset resolution. Everything else is scripting/CI. Mitigated by doing it first behind a clean interface with a dev/npm/binary fallback.
2. **Binary size** ~50–80 MB each, 5 per release — fine for GitHub Releases; a reason to keep `--minify --bytecode`.
3. **Unsigned binaries** trip macOS Gatekeeper / Windows SmartScreen. v1 documents `xattr`/`Unblock-File`/"Run anyway"; signing + notarization is a deliberate later step (the build pipeline leaves a clean hook for it).
