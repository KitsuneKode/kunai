# Plan 061: install.ps1 parity gaps — and the contract that stops the next one

> **Drift check (run first):** `git diff --stat 51f19b633..HEAD -- install.ps1 install.sh apps/cli/test/integration/install-scripts-pwsh.test.ts apps/cli/test/integration/install-scripts.test.ts`
> Mismatch → re-read the `switch ($Method)` block at the bottom of install.ps1 and the env-seam block (~:41-58) before proceeding.

Found during the audit-2 S6 distribution sweep (which the ledger never closed).

## Status

- **Priority:** P3
- **Effort:** S
- **Risk:** LOW — touches the Windows installer; the pwsh integration suite exercises both seams
- **Depends on:** none
- **Category:** distribution / parity
- **Planned at:** `51f19b633`, 2026-09-19

## Why this matters

install.ps1 and install.sh are two implementations of one contract, kept in
step by hand. These two gaps are what that process costs: nothing errors, the
Windows user just silently gets a different install than they asked for.

The two fixes are a morning's work. The reason this plan exists is the third
step: today there is no artifact that *says* what the contract is, so the next
env seam or post-install step added to install.sh will drift the same way. The
pwsh suite already regex-extracts functions from both scripts — a parity
assertion over the `KUNAI_*` env sets is the same mechanic, and turns
"someone remembers to port it" into a CI failure.

## Current state

### 061.1 — `-Method source` ignores `KUNAI_REPO`

`install.sh` treats the clone URL as a user-owned seam:

```sh
# install.sh:27
KUNAI_REPO="${KUNAI_REPO:-https://github.com/KitsuneKode/kunai.git}"
# install.sh:2065
run git clone --depth 1 "$KUNAI_REPO" "$SOURCE_DIR"
```

`install.ps1` already honors the sibling overrides — `KUNAI_DL_BASE` (:41),
`KUNAI_RELEASES_API` (:42), `KUNAI_SOURCE_DIR` (:2381) — but hardcodes the
clone:

```powershell
# install.ps1:2386
Invoke-Step "git clone Kunai into $src" { & git clone --depth 1 'https://github.com/KitsuneKode/kunai.git' $src }
```

Concrete failure: a self-hoster sets `KUNAI_RELEASES_API`/`KUNAI_DL_BASE` to a
fork's releases, then runs `-Method source` on Windows — the release path
honors the fork, the source path silently clones upstream.

### 061.2 — Optional deps offered only for `-Method binary`

```powershell
# install.ps1:2410-2412
if ($Method -eq 'binary') {
  Install-OptionalDeps
}
```

`install.sh:2260` runs `install_optional_deps` unconditionally — every install
method gets the mpv/yt-dlp/curl check. A Windows user on `-Method npm`, `bun`,
or `source` receives zero dependency guidance and discovers missing mpv at
first playback. The pwsh suite
(`install-scripts-pwsh.test.ts:1926-2060`) exercises `Install-OptionalDeps`'s
consent internals only; nothing pins the binary-only gate, so it looks
incidental rather than decided — but if a maintainer confirms it was deliberate
(e.g. "package-manager users self-provision"), close this section instead of
shipping it.

Note: `Install-OptionalDeps` also provisions the portable yt-dlp /
curl-impersonate helpers into Kunai's data dir (`install.ps1:1974-1987`).
Those are method-independent — the data dir is the same for an npm install —
so the whole function can move out of the guard. No split is needed.

### 061.3 — The parity contract is oral

`KUNAI_*` seams in install.sh: `KUNAI_REPO`, `KUNAI_DL_BASE`,
`KUNAI_RELEASES_API`, `KUNAI_INSTALL_METHOD`, `KUNAI_INSTALL_VERSION`,
`KUNAI_INSTALL_YES`, `KUNAI_INSTALL_DRY_RUN`, `KUNAI_SKIP_DEPS`,
`KUNAI_SKIP_PATH_UPDATE`, `KUNAI_BIN_DIR`, `KUNAI_DATA_DIR`, plus helper pins
(`KUNAI_YTDLP_RELEASE_BASE`, `KUNAI_CURL_IMPERSONATE_*`). install.ps1 has all
of them **except `KUNAI_REPO`**. There is no list of what the set is supposed
to be.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| ps1 syntax check | `pwsh -NoProfile -Command '$null = [scriptblock]::Create((Get-Content -Raw ./install.ps1))'` | no parse errors |
| Focused tests | `bun run --cwd apps/cli test:file test/integration/install-scripts-pwsh.test.ts` | all pass (pwsh-gated: skipped on hosts without pwsh — check the skip line, not just failures) |
| Bash twin | `bun run --cwd apps/cli test:file test/integration/install-scripts.test.ts` | all pass |
| Full gates | `bun run typecheck --force && bun run test --force` | exit 0 |

## Scope

**In scope:**
- `install.ps1` (env seam + method gate)
- `apps/cli/test/integration/install-scripts-pwsh.test.ts` and/or
  `install-scripts.test.ts` (coverage + the parity assertion)

**Out of scope:**
- `install.sh` — already correct on both points; it is the reference.
- The `Invoke-Expression $command` path at `install.ps1:1618` — reviewed and
  safe today (`$missing` is a closed literal set: `'mpv'`, `'yt-dlp'`,
  `'curl'`). The `default` branch of `Get-PackageInstallCommand` (:1564)
  interpolates `$Package`, which is a latent footgun for a *future* caller
  passing user-derived names — not reachable today, not this plan's job. If a
  later change widens the input set, that is a security review.
- Semantic (behavioral) parity — this contract asserts seam *names* and
  method coverage, not that both scripts do the same thing with them.

## Steps

### Step 1: `KUNAI_REPO` seam

At `install.ps1` ~:43 (next to `$DlBase`/`$ReleasesApi`), add:

```powershell
$Repo = if ($env:KUNAI_REPO) { $env:KUNAI_REPO } else { 'https://github.com/KitsuneKode/kunai.git' }
```

Then at :2386 replace the literal URL with `$Repo`.

**Verify:** dry-run a source install with `KUNAI_REPO` pointed at a local bare
fixture (the suite's pattern for fake remotes) → clone hits the fixture, not
github.com.

### Step 2: Optional deps for every method

Change the tail of install.ps1 from `if ($Method -eq 'binary')` to an
unconditional `Install-OptionalDeps`. If review reveals the portable-helper
drop was deliberately binary-scoped, the narrower correct fix is splitting
`Install-OptionalDeps` — helpers stay binary-only, the `$missing` prompt runs
for all methods — but default to the simple move; install.sh does not split.

**Verify:** pwsh test asserting `Install-OptionalDeps` is invoked for
`-Method npm` (mock `Test-Cmd` so mpv is absent; assert the prompt/print path
runs).

### Step 3: Encode the contract

Add a test that extracts `KUNAI_([A-Z_]+)` identifiers from both scripts and
asserts the sets are equal, with an explicit `KNOWN_PLATFORM_ONLY` exception
list (e.g. `KUNAI_SOURCE_DIR` is ps1-only by shape today — every entry in the
exception list is a reviewed decision, and the list is the diff reviewers will
read on the next drift). Same file each script's seams live in, one grep each;
assert in `install-scripts.test.ts` (non-pwsh-gated) so it runs everywhere.

Also assert the method-coverage invariant directly: the script tail invokes
`Install-OptionalDeps` outside any `$Method` guard (a structural regex on the
`switch`/tail block is enough — the suite already does this shape).

## Test plan

- New: `KUNAI_REPO` is honored on `-Method source` (clone URL == override).
- New: optional-deps path runs for a non-binary method.
- New: env-seam parity assertion with the exception list.
- Regression: existing consent tests (prompt defaults to no, `-Yes` prints
  instead of executing, redirected input prints) still pass.

## Done criteria

- [ ] `install.ps1` reads `KUNAI_REPO` with the upstream default
- [ ] `Install-OptionalDeps` is invoked for all four methods (or the split is
  made, with a comment recording the deliberate binary-scope)
- [ ] The `KUNAI_*` seam sets of both scripts are asserted equal modulo a
  reviewed exception list
- [ ] `bun run test --force` exits 0

## STOP conditions

- The `switch ($Method)` dispatch or `Install-OptionalDeps` was refactored —
  re-derive the gap from `install.sh` rather than matching line numbers.
- A maintainer says the binary-only deps offer was deliberate → drop 061.2 and
  add a comment at `install.ps1:2410` recording that decision (the parity test
  should then carry that as a documented exception).

## Maintenance notes

- The exception list in the parity test is the contract's changelog: a new
  env seam added to one script fails CI until either the twin lands or a
  reviewer adds it to the list with a reason.
