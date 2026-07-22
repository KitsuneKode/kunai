# 024 — Distribution route + a real update experience

- **Written against commit**: `bbbce781`
- **Priority**: P1 (the npm lane is currently broken, not merely suboptimal)
- **Effort**: L overall; stage 1 alone is M and delivers most of the value
- **Risk**: MED — changes the published artifact. Every stage is verifiable in a container before release.
- **Supersedes**: the postinstall section of plan 023 (023.1). That treated a symptom; this fixes the cause.

## The problem, measured

```
$ node dist/kunai.js --version
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: … Received protocol 'bun:'
```

`apps/cli/package.json` sets `"bin": {"kunai": "dist/kunai.js"}`, and that file is the
**entire 2.7MB app** with a `#!/usr/bin/env bun` shebang that imports `bun:` modules.

So `npm install -g @kitsunekode/kunai` — advertised in `README.md:127` as the
alternative _to_ Bun — produces a `kunai` command that cannot start without Bun. The
failing postinstall hook is the first symptom, not the disease.

Meanwhile the repo already builds **8 standalone binaries** (`build-binaries.ts`) and
publishes **none** of them to npm (`files` lists only `dist/kunai.js`,
`dist/postinstall.js`, `dist/assets/**`).

**The hard part is done. The distribution wiring is missing.**

---

## The route decision

### Option A — Node launcher + per-platform `optionalDependencies` (RECOMMENDED)

The npm package becomes a small `#!/usr/bin/env node` launcher carrying no app logic.
Platform binaries ship as separate packages (`@kitsunekode/kunai-linux-x64`, …) declared
as `optionalDependencies` with `os`/`cpu` fields, so npm/bun/pnpm resolve exactly one.

**Good**

- Kills the Bun requirement on the npm lane outright — the actual bug.
- **Precedent is already inside this repo.** `turbo` (a direct dependency) ships
  `bin/turbo` as `#!/usr/bin/env node` with six `@turbo/<platform>` optionalDependencies.
  `oxlint`/`oxfmt` do the same. This is the ecosystem-standard shape, not an invention.
- Works under `--ignore-scripts` and pnpm's default script blocking, because there is
  **no install-time work at all** — which lets us delete the postinstall hook and its
  untestable integration test.
- No network access beyond the registry: airgapped and CI installs work.
- Users download **one** platform package, not all eight.

**Bad / cost**

- 8 more packages to publish per release; the release pipeline must publish platform
  packages _before_ the launcher, or a fresh install resolves a version that does not
  exist yet.
- npm registry weight (see sizing below).
- A new failure mode to handle explicitly: optional dependency skipped or corrupted →
  the launcher must fail with an actionable message, not a stack trace.

**Sizing — measured, not estimated.** npm serves gzipped tarballs, so compressed size
is what a user pays:

| binary                  | raw   | gzipped   |
| ----------------------- | ----- | --------- |
| `kunai-linux-x64`       | 94 MB | **35 MB** |
| `kunai-darwin-arm64`    | 64 MB | **24 MB** |
| `kunai-windows-x64.exe` | 97 MB | **37 MB** |

24–37 MB for one platform is unremarkable for a compiled CLI. Bun-compiled binaries are
large because they embed the runtime; `--minify` and dropping the `-musl` variants (glibc
covers most Linux users; musl users have `install.sh`) are the levers if it matters.

### Option B — Launcher that downloads the binary on first run

**Good:** tiny npm package; reuses the existing GitHub-releases + `SHA256SUMS`
verification the native installer already has.
**Bad:** needs network after install, breaks airgapped/CI/deterministic builds, adds a
first-run latency spike, and duplicates download/verify logic that `install.sh` owns.
**Verdict:** rejected — Option A is strictly better here because the binaries are small
enough compressed and the registry can carry them.

### Option C — Keep Bun-only npm, document it honestly

**Good:** zero work. **Bad:** the README's npm line stays a lie, and "install our JS CLI
with npm" failing is the kind of first impression that loses users silently.
**Verdict:** only acceptable as a stopgap, and then the README must say
"requires Bun" on that line the same day.

### Recommendation

**Option A, with the native installer staying primary.** These are not competing routes
and should not be symmetric:

- `install.sh` / `install.ps1` + `kunai upgrade` is the **best** experience — it has
  staging, transactions, version retention, rollback and lock files, all of which npm
  cannot do. Keep promoting it first.
- npm/bun global is the **familiar** experience for a JS-ecosystem CLI. It only has to
  _work_, and route upgrades back to the package manager.

---

## Stage 1 — The Node launcher and platform packages (M)

### 1.1 Build platform packages

Extend `apps/cli/scripts/build-binaries.ts` to emit, per target, a publishable package:

```
@kitsunekode/kunai-linux-x64/
  package.json   # name, version (lockstep with the CLI), os: ["linux"], cpu: ["x64"]
  bin/kunai      # the prebuilt binary, mode 0755
```

Windows packages carry `bin/kunai.exe`. Version must match the parent exactly —
mismatched versions are the classic failure of this pattern.

### 1.2 Write the launcher

`apps/cli/scripts/npm-launcher.mjs` → published as `dist/kunai.mjs`, and `bin` points at
it. Hard constraints, all load-bearing:

- `#!/usr/bin/env node`. **No Bun. No `bun:` imports. No TypeScript.** Ship it as plain
  ESM — do not run it through the Bun bundler, which is what introduced `bun:` in the
  first place.
- Resolve the platform package with `createRequire(import.meta.url).resolve(...)`, fall
  back to a local `vendor/` directory (keeps source checkouts and CI working).
- On miss, throw an error naming the exact reinstall command for the detected package
  manager — reuse `updateGuidanceForInstallMethod` rather than writing new copy.
- Spawn **asynchronously** (`spawn`, never `spawnSync`) so signals are deliverable.
- Forward `SIGINT`/`SIGTERM`/`SIGHUP` to the child.
- Mirror the child's exit: on signal death, **re-emit the signal** so the parent exits
  with 128+n; otherwise pass the code through. `src/main.ts:1081-1083` already encodes
  the same semantics (130/143/129) and is the reference.

### 1.3 Package manager detection

`detectInstallMethod` (`src/services/update/install-method.ts:18`) currently matches path
substrings only and recognizes source / bun-global / npm-global / binary. Two gaps worth
closing while here:

- **pnpm is not detected at all** — it would report `unknown`. pnpm's isolated layout
  means the owning `node_modules` can be several parents up, so detection needs a
  `.modules.yaml` check plus a `realpath` comparison against the package root, walking
  ancestors. A naive substring check misses it.
- `npm_config_user_agent` / `npm_execpath` are ignored; they are the most reliable signal
  when present.

### 1.4 Delete the postinstall hook

With a real launcher there is nothing to do at install time. `detectInstallMethod` plus
the existing `install.json` fallback already covers routing on first run. Removing it
deletes a failure mode, a build artifact, a bundle target, and an integration test that
could not test the case that mattered.

### Verification (this is the whole point — do not skip)

A container with **no Bun on PATH**:

```sh
npm install -g @kitsunekode/kunai
kunai --version            # must work
kunai upgrade --check      # must route to the npm channel
```

Add it to `test/install/scenarios/`. The existing
`test/integration/npm-global-install.test.ts` cannot catch this — it is gated behind
`KUNAI_NPM_GLOBAL_INSTALL=1` and runs on a machine that has Bun, so the Bun-less case is
unreachable by construction.

**STOP and report** if platform-package publishing cannot be made atomic with the parent
publish. A launcher whose platform package does not exist yet is worse than today.

---

## Stage 2 — Make "update available" actually update (S, high value)

Today the loop is: check → notify → **open a web page**.

`NotificationActionRouter.ts:93-104` — the `update-app` action calls
`openReleasePage(...)` and nothing else. So Kunai detects the update, tells the user, and
then hands them to a browser — while `kunai upgrade`, backed by a full transactional
native installer with rollback, sits one call away.

**Fix.** Make `update-app` route by install method:

| method                             | action                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `binary` (native installer)        | run the real in-place upgrade, with progress and a rollback path on failure                          |
| `npm-global` / `bun-global` / pnpm | show the exact one-line command for that manager (cannot self-update safely under a package manager) |
| `source`                           | show the git pull / build guidance that already exists                                               |

`updateGuidanceForInstallMethod` already produces the right sentence per method — this is
mostly wiring, not new logic.

**Also:** `updateChannel` (`"stable" | "latest"`) is a config key with **no reader** — its
only reference is the getter — while `cli-args.ts:89` advertises `kunai upgrade` as
"channel-aware" and both installers describe themselves the same way. Either wire it into
`run-upgrade.ts` or strike the claim from all three places.

---

## Stage 3 — Autoupdate, deliberately conservative (M)

There is **no autoupdate today** — only a check plus a notification. The config already
has the right primitives: `updateChecksEnabled`, `updateCheckIntervalDays`,
`updateSnoozedUntil`.

Recommended policy, and the reasoning matters more than the mechanism:

- **Default: notify, do not auto-install.** Kunai launches `mpv` and holds playback
  state; silently swapping the binary under a running session is how you corrupt someone's
  evening. Codex, gh and rustup all default to notify-only for the same reason.
- **Opt-in `autoUpdate: "off" | "notify" | "install"`**, honored only for the `binary`
  install method (a package-manager install must never self-mutate — that fights the
  package manager, which is the exact thing `install.json` exists to prevent).
- **Install on exit, never mid-session**, using the existing staging + transaction +
  version-retention machinery so a failed update rolls back.
- Respect `updateSnoozedUntil` and offer "skip this version".

**STOP and report** before implementing `"install"` — auto-installing a binary that plays
network video is a meaningful trust decision, and it should be the maintainer's call
whether it ships at all.

---

## What this fixes, end to end

| Today                                                 | After                                       |
| ----------------------------------------------------- | ------------------------------------------- |
| `npm i -g` yields a CLI that cannot start without Bun | works on plain Node                         |
| postinstall can fail the whole install                | no install-time work at all                 |
| pnpm users report `unknown` install method            | detected and routed                         |
| "Update available" → a web page                       | in-place upgrade, or the exact command      |
| No autoupdate                                         | opt-in, binary-only, on exit, rollback-safe |
| 8 binaries built, 0 distributed via npm               | one resolved per platform                   |

## Done criteria

```sh
bun run typecheck && bun run lint && bun run test
bun run build && bun run test:installer:scenarios
```

Plus:

- A no-Bun container install that runs `kunai --version` successfully.
- A launcher unit test asserting signal forwarding and 128+n exit mirroring.
- A test that `update-app` routes to in-place upgrade for `binary` and to guidance text
  for `npm-global` / `bun-global`.
- `rg -n 'postinstall' apps/cli/package.json` returns nothing.

## Maintenance note

The one recurring failure of this pattern is **version skew** between the launcher and
its platform packages. Add a release-gate check (next to the existing
`scripts/release-guard.ts`) asserting every platform package's version equals the CLI's
before publish, and publish platform packages first.
