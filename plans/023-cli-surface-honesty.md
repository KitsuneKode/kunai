# 023 — CLI surface honesty: packaging, flags, docs, first run

- **Written against commit**: `01ab215b`
- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (023.1 changes the published install path — verify in a container)
- **Depends on**: nothing. 023.2 pairs naturally with plan 020.5.

## Why this matters

Everything here is a promise the CLI makes and does not keep: an install hook that can
fail the install it exists to support, flags that no-op, docs that teach dead
keybindings, an `.env.example` describing a product that does not exist.

---

## 023.1 — The npm postinstall hook (S)

`apps/cli/package.json`: `"postinstall": "bun dist/postinstall.js"`.

**What it does.** `apps/cli/scripts/postinstall.ts` writes
`~/.config/kunai/install.json` recording _how_ Kunai was installed, so `kunai upgrade`
and `kunai uninstall` route correctly and "never fight another installer"
(`install-manifest.ts:11`). With four install paths that need is legitimate.

**What is wrong with it.**

1. **It makes Bun a hard requirement of the Bun-free install path.** README:127
   advertises `npm install -g @kitsunekode/kunai` _or_ `bun install -g`. The npm
   variant exists for people without Bun. They run it, npm executes
   `bun dist/postinstall.js`, `bun` is not on PATH, nonzero exit — **npm fails the
   whole global install.**
2. **The work does not need to happen at install time.** Everything it computes
   (`npm prefix -g`, does the bin exist, what version) is equally computable on first
   launch, where there is a running process, a logger, and a place to show an error.
   The lazy path already exists: the manifest is "Authoritative when present;
   otherwise callers fall back to `detectInstallMethod`."
3. **postinstall hooks increasingly do not run.** `--ignore-scripts` is common in CI
   and locked-down npm configs; pnpm blocks them by default. Those users already land
   on `detectInstallMethod` and are fine — which proves the hook is optional.
4. **Node compatibility is unverified.** The bundle is built with `target: "bun"`
   (`scripts/build-shared.ts:73`). Running `node dist/postinstall.js` in a dev checkout
   exits 0, but only because it early-returns at
   `scripts/postinstall.ts:26` (`isGlobalNpmInstall` is false) — it never reaches
   `writeInstallManifest`. Do not read that as evidence it works.

**Recommended fix: delete the hook.** Do the detection lazily on first run behind the
fallback that already exists. That removes a failure mode, a build artifact, a bundle
target and an untestable integration test.

**If it is kept instead**, the minimum is all three of: build with `target: "node"`,
invoke with `node` not `bun`, and suffix `|| exit 0` so it can never fail an install.

**Verify.** `apps/cli/test/integration/npm-global-install.test.ts` is gated behind
`KUNAI_NPM_GLOBAL_INSTALL=1` so `bun run test` skips it, and it runs on a machine that
has Bun — so the Bun-less case is unreachable by construction. Add a container check
that installs with **no Bun on PATH** and asserts the install succeeds and
`kunai --version` reports the npm-global channel.

---

## 023.2 — Flags that lie (S)

- **`--dry-run` changes everything except the one path it guards.** Read at exactly
  one site: `main.ts:633`, inside the `installProtocolHandler` branch. Yet
  `docs/users/cli-reference.mdx:88` says it "prints the planned bootstrap without
  changing state" — in reality `kunai --dry-run -S "Dune"` boots the shell, writes
  config, runs update checks and can start playback. **Fix:** reject `--dry-run`
  combined with anything other than `--install-protocol-handler` / `rollback`, exit
  non-zero, and correct the docs.
- **`--no-user-mpv-config` is a no-op.** See plan 020.5 — same fix, land it there.
- **Typos become searches.** Subcommands are matched by exact `argv[0]`
  (`main.ts:559-596`); anything else falls through to
  `cli-args.ts:369-374`, which turns leftover positionals into the search query. So
  `kunai upgrde` launches the TUI searching for "upgrde" and **exits 0** — scripted
  upgrades cannot detect the mistake. **Fix:** add a `SUBCOMMANDS` set; if `argv[0]` is
  a non-flag token within edit distance 2 of one, print `unknown command` to stderr and
  exit 2. Preserve bare-query launch (`kunai dune`).
- **Dropped values warn nowhere.** `--jump abc` / `--jump 0` fail validation and are
  discarded silently (`cli-args.ts:341-344`) while every other malformed input pushes
  to `warnings`.

---

## 023.3 — Exit codes for non-interactive use (S)

`kunai --download` is the one genuinely scriptable surface and it exits 0 whether the
file downloaded, the queue errored, or nothing was selected:

- `main.ts:427-430` — cancel prints and `return true`, no exit code.
- `main.ts:460-461` — `"Download queue failed: …"` goes to **stdout**, not stderr, with
  no exit code.
- `main.ts:657-661` — invalid `--handoff-url` prints to stderr and returns **0**, while
  the sibling `--open` branch at `:649-655` correctly sets `process.exitCode = 1`.
  `--handoff-url` is what the registered `kunai://` protocol handler invokes, so a
  malformed link reports success to the desktop environment.

**Fix.** Have `maybeRunDownloadMode` return a status rather than a boolean, set
`process.exitCode = 1` on error/cancel, route failures to stderr, and mirror the
`--open` branch in `--handoff-url`.

**Related:** nothing guards a non-TTY launch. `shouldRunSetupWizard`
(`startup-setup.ts:14-22`) has no TTY term, and the wizard mounts an Ink `useInput`
flow whose promise only settles on a keypress — but raw mode is skipped when
`!process.stdin.isTTY` (`ink-shell.tsx:132,154`), so there is no input path to settle
it. `kunai -S "x" | tee log` or a container first-run **hangs indefinitely**. The
codebase already knows about non-TTY elsewhere (`main.ts:864-869` auto-declines
telemetry; `image/capability.ts:87` disables posters) — the guard was just never
extended. **Fix:** refuse to mount Ink without a TTY with a clear stderr message and
exit 2; skip the wizard on non-TTY.

---

## 023.4 — Docs that are actively wrong (M)

Per the audit playbook, stale docs that are wrong are worse than missing.

`.docs/cli-reference.md` declares itself canonical and is wrong three ways:

- Line 7 and 231 name `apps/cli/src/main.ts` — `parseArgs()` as the source of truth
  for flags. Flag parsing moved to `apps/cli/src/cli-args.ts` (`parseCliArgs`);
  `main.ts` has no `parseArgs`.
- Lines 47-94 omit `-y/--youtube`, `-z/--zen`, `--setup`, `--download`,
  `--download-path`, `--discover`, `--support-bundle`, `--debug-json`,
  `--debug-session`, `--open`, `--dry-run`, `-h`, `-v`, and all six subcommands.
- Lines 136/138 teach `r` for reload and `f` for provider fallback. Actual chords are
  **Ctrl+R** (`keybindings.ts:483`) and **Shift+F** (`:359`). `README.md:541-542`
  repeats the same wrong trio.

Also: `README.md:537` lists provider **allmanga**; the user-facing id is `allanime`
(`allmanga` is only the source directory). `.docs/quickstart.md:101-103` documents
`test:vhs:browse|help|launch` — none exist (only `setup`, `offline`, `palette`, `all`).

**Fix.** Generate the flag table from `buildCliHelpText()` and the keybinding table
from `KEYBINDINGS`, in the same codegen step that already feeds
`apps/docs/scripts/sync-code-metadata.ts:238`. Then drift becomes a build failure
instead of a documentation chore.

---

## 023.5 — `.env.example` is fiction, and the real env surface is undocumented (S)

`.env.example` declares `NEXT_PUBLIC_KUNAI_PROXY_URL`, `KUNAI_WASM_SALT`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `REAL_DEBRID_API_KEY` and
describes a "$3/mo Premium Tier". Grep across `apps/`, `packages/`, `scripts/` returns
**zero** references to any of those names. It is the one file a new contributor copies.

Meanwhile these change runtime behavior and appear in no user doc:
`KUNAI_MEM_CAP_MB` and `KUNAI_NO_MEMORY_GUARD` (the watchdog **SIGKILLs the process**
at the cap — `memory-watchdog.ts:24,87,97`), `KUNAI_PLAYLIST_SHARING`,
`KUNAI_EXPERIMENTAL_PROVIDER_AVAILABILITY_SYNC`, `KUNAI_RELEASES_API` (redirects the
update check to an arbitrary host), `KUNAI_TELEMETRY_URL`, `KUNAI_DISABLE_EXTERNAL_URL`,
`KUNAI_REDUCED_MOTION`, `KUNAI_ANILIST_CLIENT_ID`, `KUNAI_TMDB_API_KEY`.

**Fix.** Rewrite `.env.example` from the actual `process.env` reads, and expand the
Environment table in `.docs/cli-reference.md` to cover the user-facing subset.

---

## 023.6 — Two "shipped" features are gated behind undocumented switches (S)

- `docs/feature-status.yaml:35-37` marks `catalog-sync` (AniList/TMDB) **shipped** on
  the public docs site, but `AniListAdapter.ts:66-72` refuses to connect unless the
  user registers their own AniList OAuth app and exports `KUNAI_ANILIST_CLIENT_ID`,
  documented nowhere. Compounding it, every `sync*` command is unreachable from the
  palette (see the conformance baseline) — so the integration has no entry point at
  all. **Fix:** downgrade to `beta` with a documented prerequisite, and land the
  palette wiring.
  _Unverified:_ the token exchange (`:91-99`) posts no `client_secret`, which AniList's
  code grant requires. Check against a live app before promoting.
- `.docs/features/playlists.md:24-33` documents export/import unconditionally;
  `shell-workflows.ts:2431,2656-2658` gate them behind `featureFlags.playlistSharing`,
  default **false**.

---

## 023.7 — First-run dependency guardrail self-suppresses (M)

`ui.ts:170-186` prints remediation only when `shouldShowRemediation` (no previous
state, or version/fingerprint changed) and saves the notice state immediately. On run
#2 with mpv still missing the user gets only the bare
`"mpv not found — required for playback (shell still available)."` — no install
commands. The gate is "have I shown this once", not "is the issue resolved".

`severity: "fatal"` (`ui.ts:100-116`) has exactly one consumer —
`doctor.ts:353`, which maps it to a report label. Nothing blocks, prompts or exits:
`kunai -y` with no yt-dlp boots the full YouTube shell and fails at playback.

Installer parity gaps: `install.sh:818-837` never verifies an optional-dep install
succeeded and never offers `ffprobe` despite README:262 listing it; `install.ps1` has
no `-SkipDeps` switch (cf. `install.sh:863`) and no chafa prompt, though
`ui.ts:118-131` raises a Windows-Terminal-specific chafa issue.

**Fix.** Gate remediation on _resolution_, not on having shown it; render a persistent
capability banner in the shell for any `fatal` issue; add `-SkipDeps` + chafa to
`install.ps1` and `ffprobe` to `install_optional_deps`.

## Done criteria

```sh
bun run typecheck && bun run lint && bun run test
bun run verify:readme:commands
```

Plus: a container install test with **no Bun on PATH** (023.1); a parity test asserting
every `.option()` appears in `buildCliHelpText()` and vice versa (023.2); exit-code
tests for `--download` and `--handoff-url` (023.3); and a non-TTY smoke test that
asserts a clean exit rather than a hang.
