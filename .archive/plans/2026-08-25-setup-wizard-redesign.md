---
status: landed
lastReviewed: "2026-08-25"
---

# Setup wizard redesign

> Design spec. Code wins; when this disagrees with the tree, fix this file.

**Goal:** A first run that looks like Kunai, asks only what changes behavior,
writes everything it asks about, tells the truth about the machine it is on, and
never has to be shown twice.

Owns the redesign of `apps/cli/src/app-shell/setup-shell.tsx`,
`apps/cli/src/app-shell/workflows/setup-workflows.ts`,
`apps/cli/src/app/bootstrap/startup-setup.ts`, the curl resolver in
`packages/providers/src/shared/curl-impersonate.ts`, and the `curl` field of
`CapabilitySnapshot` in `apps/cli/src/ui.ts`.

## Why

The shipped wizard is seven slides of which three ask nothing, and it is the
only surface in the app that does not wear the shell frame — no header, no
surface label, no `[/] commands`. `.reference/design/cli/kunai-sakura-systems.html`
already specifies onboarding inside that frame and the implementation ignores it.

Beyond the look, eight defects were confirmed against the tree on 2026-08-25.
They are listed in [Defects](#defects) with the fix that closes each.

## Locked decisions

| Decision          | Value                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Screen count      | 7, every one of which asks something or pays something off                                      |
| Frame             | Sakura shell frame (header · body · footer) on every screen                                     |
| Progress          | `setup · N⁄7` in header right; dotline at body bottom. `WizStepCounter` is deleted              |
| Skip              | `s` = accept recommended for this step; `S` = accept all remaining and jump to 7; `esc` = abort |
| Skip writes       | Skipping **writes the recommended config**. It never writes nothing                             |
| Tailoring         | Screen 2 (`defaultMode`) tailors which options screens 3–5 lead with                            |
| Analytics default | Pre-selected **on**, with `s`/`S` unable to enable it (see [Analytics](#analytics))             |
| Accounts          | Toggled inline on screen 5; OAuth/IPC connect runs **after** the wizard commits                 |
| Non-TTY           | Wizard never mounts; recommended config written; `--setup` in a non-TTY exits 1                 |
| ffprobe           | Reframed as `ffmpeg`, shown only when downloads/YouTube are in play                             |
| Existing users    | Already-onboarded installs are **not** re-onboarded (see [Migration](#migration))               |
| mpv missing       | Degrades, never blocks. `[r]` rechecks; a live issue surfaces at every launch                   |
| Performance       | Fast, not showy. No network call before consent (see [Performance](#performance))               |

**The rule behind three of these:** _no skip path may perform an outward-facing
action._ Accept-all writes local config and nothing else — it never enables
analytics, opens a browser for AniList, or touches Discord IPC. A recommendation
the user pressed a key on is consent; a default they never saw is not.

## Screens

All seven are rendered inside the shell frame. Header grammar per
`.reference/design/cli/01-shell-footer-contract.md`:
`🦊 Kunai · <context>` left, `setup · N⁄7` right. Footer: max four keys plus the
`Setup` surface label.

### 1 · Welcome + system check

Merged per the design authority ("step one already feels like the product, not a
config form"). Lists every dependency with its **resolved path**, a role tag, and
a status glyph in a fixed 3-cell lane.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 🦊 Kunai · welcome                                            setup · 1⁄7  │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   Let's get you watching                                                   │
│   Kunai finds playable streams and hands them to mpv.                      │
│   Here's what's on this machine.                                           │
│                                                                            │
│     ✓  mpv                /usr/bin/mpv                        playback     │
│     ✓  yt-dlp             /usr/bin/yt-dlp                     youtube · dl │
│     ✓  ffmpeg             /usr/bin/ffprobe                    quality · dl │
│   ▌ △  curl-impersonate   plain curl only                     anime search │
│        Anime search can come back empty behind Cloudflare.                 │
│     ✓  posters            kitty protocol · ghostty                         │
│     ✓  data & cache       ~/.local/share/kunai                             │
│                                                                            │
│                                ● ○ ○ ○ ○ ○ ○                               │
├────────────────────────────────────────────────────────────────────────────┤
│ [enter] continue  [d] how to fix  [r] recheck  [s] skip           Setup    │
└────────────────────────────────────────────────────────────────────────────┘
```

- `↑↓` moves the selection rule; `[d]` opens the fix sheet for the **selected**
  row with the command for the **detected** platform only.
- `[r]` re-probes. `SakuraPetal` runs in `loading` mode per row while probing and
  settles to `complete` as each resolves.
- Severity: `✗` crimson only for mpv (blocks playback). `△` for degraded.
  `✓` mint for present.

### 2 · What you watch

Sets `defaultMode`. Three options: Anime · Shows & movies · YouTube. The choice
tailors screens 3–5 (see [Tailoring](#tailoring)).

### 3 · Language

Audio and subtitle on one screen, applied to **all three** language profiles.

### 4 · Playback feel

Toggle group: `autoNext`, `skipIntro`, `skipCredits`. `space` toggles.

### 5 · Downloads & accounts

```
│   ▸ Downloads          on    ~/.local/share/kunai/downloads                │
│     Quality           1080p                                                │
│                                                                            │
│   While we're here                                                         │
│   ◈ AniList sync      ─ track progress on your list                  [on]  │
│   ◈ TMDB sync         ─ shows & movies                              [off]  │
│   ◈ Discord presence  ─ show friends what you're watching           [off]  │
```

Toggles record **intent only**. `connectAfterSetup` intents are executed by the
caller after config commits, so a failed browser handoff never traps the wizard.

### 6 · Usage ping

See [Analytics](#analytics). Standalone; never bundled with other toggles.

### 7 · You're all set

Reflects back the chosen config, carries forward anything unresolved, and adapts
its primary action to the launch intent.

```
│                    ❀                                                       │
│              You're all set                                                │
│              Anime · Japanese audio · English subs                         │
│                                                                            │
│   ✓  Downloads on          ~/.local/share/kunai/downloads · 1080p          │
│   ✓  Auto-skip             intro and credits                               │
│   ✓  Usage ping on         change any time in /settings                    │
│   △  AniList               opening your browser to finish linking…         │
│   △  curl-impersonate      not installed — anime search may come up empty  │
│                                                                            │
│   Try these first                                                          │
│     type a title, or  /discover  ·  /calendar  ·  /random                  │
│     press  /  any time for commands                                        │
```

The mint `❀` is `SakuraPetal` in `complete` mode — the same glyph that bloomed
rose on screen 1, now settled.

## Tailoring

`defaultMode` from screen 2 changes which option each later screen **leads
with**. It never hides an option; every choice stays reachable with `↑↓`.

| Mode           | Screen 3 leads with           | Screen 5 pre-checks | Screen 1 severity                    |
| -------------- | ----------------------------- | ------------------- | ------------------------------------ |
| Anime          | Japanese audio · English subs | AniList             | curl-impersonate promoted            |
| Shows & movies | Original audio · English subs | TMDB                | curl-impersonate demoted             |
| YouTube        | Quality-first                 | neither             | yt-dlp + ffmpeg promoted to blocking |

## Skip semantics

| Key       | Meaning                                                | Writes                           |
| --------- | ------------------------------------------------------ | -------------------------------- |
| `s`       | Accept the recommended option for this step, advance   | that step's recommended value    |
| `S`       | Accept recommended for every remaining step, jump to 7 | all remaining recommended values |
| `esc`     | Abort                                                  | `onboardingVersion` only         |
| `b` / `←` | Back one screen                                        | nothing; answers are retained    |

`q` is removed as a skip alias — it currently skips silently and is advertised
nowhere.

**Skipping produces a working, recommended configuration.** The current
behavior — `skip()` builds prefs and `runSetupWizard` discards them — is the bug
this replaces.

## Analytics

Screen 6 pre-selects **on** and leads with a privacy-first explanation. Every
claim in the copy is verifiable against
[.docs/analytics-privacy-contract.md](../.docs/analytics-privacy-contract.md):
the wire value is `sha256` of a locally stored UUID, the raw UUID never leaves
the machine, the ingest never reads a client IP, and the payload is five keys
with a sixth rejected.

**The guardrail:** `s` on this screen selects **off**, and `S` (accept-all)
**stops here** rather than passing through. Pre-selection plus a required
keystroke remains an affirmative act; letting a blanket skip enable it would be
opt-out by the back door and would break "only an explicit enable may persist
`enabled`".

**Amended 2026-08-25**, ahead of implementation:
[.docs/analytics-privacy-contract.md](../.docs/analytics-privacy-contract.md)
now reads "user-controlled and keystroke-gated" and carries the outward-facing
rule; [AGENTS.md](../AGENTS.md) says "user-controlled, and only a keystroke turns
it on"; `docs/users/reliability-and-privacy.mdx` tells users setup recommends it
and that skipping leaves it off. The guarantees that actually protect people —
no id without consent, nothing sent in CI/non-TTY/DNT, five bounded keys,
disabling deletes the id — are unchanged.

## Dependency truth

### curl-impersonate resolver

`packages/providers/src/shared/curl-impersonate.ts` currently holds a frozen
allowlist:

```ts
["curl_firefox135", "curl_chrome136", "curl_chrome116", "curl_ff117", "curl"];
```

Verified against a machine running `curl-impersonate 2.1.0`: PATH carries
`curl_chrome150`, `curl_chrome146`, `curl_firefox147`, `curl_safari260` and
more, and the resolver selects `curl_firefox135` — a stale fingerprint — while a
dozen newer builds sit unused. `curl_ff117` is lwthiker-era naming the lexiforest
fork never ships; it is dead.

**Replace the allowlist with PATH discovery.** Upstream documents the wrapper
naming as `curl_<browser><version>[_os]` across chrome, firefox, safari, edge,
and tor. Scan PATH directories once per process, parse family + numeric version,
rank newest-first, prefer desktop over `_android`/`_ios`, skip `curl_tor*`, and
fall back to plain `curl`. Memoize the result — this replaces four `Bun.which`
calls with a directory scan and must not run on the first-paint path.

### CapabilitySnapshot

`curl: boolean` loses the one bit that matters. `probeCapabilities` already
receives `{ path, impersonates }` from the resolver and collapses it with
`!== null`, so a plain-curl machine gets a green `✓ curl Anime search ready`
followed by an empty anime search — the exact failure the row exists to prevent.

Widen it to carry the mode, and update the three readers: setup screen 1,
`capabilityFingerprint`, and `native-installer/doctor.ts:687`.

### ffprobe → ffmpeg

`ffprobe` appears in exactly one code path, `DownloadService.validateCompletedArtifact`
(`DownloadService.ts:1162`), which early-returns when it is absent. But the yt-dlp
format selectors — `bv*+ba/b` (`mpv.ts:538`), `bestvideo[height<=N]+bestaudio`
(`yt-dlp-metadata.ts:82`), `--merge-output-format mp4` (`ytdl-profile.ts:30`) —
all require ffmpeg to mux. Without it, yt-dlp silently falls back to a
progressive stream.

So: keep probing the `ffprobe` binary, present it as **ffmpeg**, and describe the
real consequence (quality ceiling), not "validates downloaded files". No platform
ships a package called `ffprobe`; all six ship `ffmpeg`.

### Platform-specific remediation

The wizard must **read** the remediation matrix already in `probeCapabilities`
rather than keeping its own shorter, mac-biased copy. It shows the one command
for the detected platform: `process.platform`, plus a `Bun.which` probe for
`pacman` / `apt` / `dnf` / `zypper` on Linux.

Verified upstream, 2026-08-25 — curl-impersonate has **no** package on Windows,
Debian, or Fedora:

| Platform        | Command                                                                |
| --------------- | ---------------------------------------------------------------------- |
| macOS           | `brew install lexiforest/tap/curl-impersonate`                         |
| Arch            | `sudo pacman -S curl-impersonate`                                      |
| Everything else | prebuilt binary from `github.com/lexiforest/curl-impersonate/releases` |

Inventing a plausible `apt install curl-impersonate` would recreate the class of
bug this plan exists to fix.

## Startup capability surface

Setup is not the only place a missing dependency matters. Today, if mpv is
absent, `checkDeps` writes one `console.error` (`ui.ts:168`) that the Ink shell
paints over milliseconds later, and `main.ts:1010` records a diagnostics entry
nobody reads. The user gets a shell that silently cannot play anything until
they try — and `--setup` silences even the console line.

**One live issue strip in the shell, derived at render.**

- Rendered in the same slot as `AnalyticsDisclosureBanner`, from
  `container.capabilitySnapshot.issues`.
- **Derived, never stored.** A persisted copy goes stale the moment the user
  installs the missing binary — the same trap as
  [notification actions](./roadmap.md). Re-probing clears the strip; nothing has
  to be dismissed for it to go away.
- **Context-gated, so it stays honest.** A blanket warning list is what makes
  people stop reading. mpv shows always (nothing plays without it). yt-dlp and
  ffmpeg show only when downloads are enabled or the mode is YouTube.
  curl-impersonate shows only in anime mode. An issue that does not affect this
  session's mode is not raised.
- **Says what is broken, not that something is.** "Playback needs mpv —
  browsing and your watchlist still work" beats "mpv missing".
- Carries the one platform-specific install command inline.
- Dismissible for the session; returns next launch while still true.

**Input constraint (real, and it shapes this):** `AnalyticsDisclosureBanner`
carries a comment explaining it deliberately takes no keyboard input, because
`ink-shell` owns a global `useInput` and a second handler would make Enter mean
two things at once. The issue strip inherits that rule — it gets **no keys**.
The fix sheet is reached through the command palette instead, which is where
`.reference/design/cli/00-principles.md` says secondary actions belong.

**Three consumers, one remediation source.** The platform-specific install text
is produced once in `probeCapabilities` and consumed by setup screen 1, this
strip, and `buildMpvMissingProblem` (`domain/playback/playback-problem.ts:38`),
which already appends `Try: <command>` when playback is attempted without mpv.
No consumer keeps its own copy — that duplication is defect #5.

## Edge cases

| Case                                 | Behavior                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Non-TTY first run                    | Wizard never mounts. Recommended config written. One stderr line naming `kunai --setup`                       |
| `--setup` in a non-TTY               | Exit 1 with the reason. Never hang on a surface nothing can drive                                             |
| `CI` / `DO_NOT_TRACK`                | As non-TTY, and analytics stays off regardless of screen 6                                                    |
| Launch intent (`-S`, `-i`, `--open`) | Wizard runs; screen 7's primary action becomes `[enter] search "Dune"` so the typed intent is visibly honored |
| Viewport too small                   | `ViewportResizeGate` keeps its message and additionally accepts `esc` to abort — today there is no escape     |
| Dep installed mid-wizard             | `[r]` re-probes without restarting the session                                                                |
| `b` after answering                  | Answers retained; no re-ask                                                                                   |
| OAuth failure                        | Surfaces on screen 7 as unresolved; never blocks the wizard                                                   |
| mpv missing                          | Setup completes; playback is what degrades, per existing `severity: "degraded"`                               |

## Migration

**This is the "bites us later" risk.** `shouldRunSetupWizard` today returns true
when `onboardingVersion < 2` **or** `!downloadOnboardingDismissed` — two gates
for one question, so the whole wizard can re-trigger on an install that already
finished it.

Changes:

1. Collapse to a single `onboardingVersion` check. `downloadOnboardingDismissed`
   stops gating the wizard.
2. Bump to `onboardingVersion: 3`.
3. **An install already onboarded must not be re-onboarded.** Treat 2 as
   satisfied; the new screens reach existing users through `/setup`, not by
   ambush. Only a fresh install sees the wizard unprompted.

Kunai has not shipped 0.3.0 yet, so the installed base for this is small and the
risk is low — but the collapsed gate is worth keeping regardless. Two gates for
one question is how the wizard became re-triggerable in the first place.

## Performance

Setup is on the first-launch path, so it inherits the startup budget.

- The workflow stays lazily imported (`() => import(...)`) — already true.
- The PATH scan for curl wrappers is memoized per process and must not run
  before first paint.
- Dependency probes run in parallel.
- Entrance stagger uses `useFrameTick(active, 90, rows.length)`, whose
  `stopAfter` clears its own interval — a settled surface runs no timer, per
  `.docs/design-system.md`.
- The stagger plays on first mount only; `[b] back` re-enters instantly.

## Design pass

Applied from `.reference/design/cli/00-principles.md` and
`01-shell-footer-contract.md`:

1. **Shell frame on every screen.** Setup rejoins the app.
2. **One progress fact.** `❮ step 1 of 7 ❯` and `● ○ ○ ○ ○ ○ ○` state the same
   thing twice, at the top, where the screen's job is not. Count → header;
   dotline → body bottom. Recovers 4 rows per screen.
3. **Motion follows work.** `SakuraPetal` currently animates on the _analytics_
   screen, under text being read — which `.docs/design-system.md` warns against —
   while the system check, the only screen doing async work, has none. Inverted.
4. **Fixed column lanes.** Name / status / path / role get fixed cell budgets
   with truncation. Today `detail` strings size the row, so rows jitter between
   screens. Status glyphs (`✓ △ ✗`) get a 3-cell lane so names align optically.
5. **Vertical rhythm.** At 100×34 the body currently ends near row 20 with a
   dozen dead rows above the footer. Body centers in available height.
6. **Selection.** Rose left rule `▌` + `accentFill` band, matching every other
   Kunai surface.

## Correctness: one source of truth

- Screen 3 imports `AUDIO_SETTINGS_OPTIONS` and `SUBTITLE_SETTINGS_OPTIONS` from
  `app-shell/settings/registry/shared.ts`. The wizard's private `AUDIO_OPTS` and
  `SUBTITLE_OPTS` — different members, order, and labels — are deleted.
- Screen 6's payload preview is built from the real `KUNAI_VERSION`,
  `process.platform`, and `process.arch`. The current string literals
  (`"0.3.0"`, `"linux"`, `"x64"`) make the consent screen false on macOS and
  Windows.
- The audio choice writes `animeLanguageProfile`, `seriesLanguageProfile`, **and**
  `movieLanguageProfile`. Today only the anime lane is written while the copy
  promises a global preference.

## Defects

Confirmed against the tree, 2026-08-25. Each closes above.

| #   | Defect                                                            | Location                                              |
| --- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | Audio written to anime lane only; series/movie silently dropped   | `setup-workflows.ts:92-104`                           |
| 2   | Skip builds prefs then discards them                              | `setup-workflows.ts:73-79`                            |
| 3   | Consent payload preview hardcoded; false off Linux/x64            | `setup-shell.tsx` analytics slide                     |
| 4   | Two divergent option lists for audio and subtitles                | `setup-shell.tsx:54-76` vs `registry/shared.ts:13-38` |
| 5   | Install hints mac-biased and weaker than `probeCapabilities`      | `setup-shell.tsx` system slide                        |
| 6   | `curl` collapses `impersonates` away; green tick on a broken path | `ui.ts:90`                                            |
| 7   | Downloads defaults to "Enable" when yt-dlp is absent              | `setup-shell.tsx` downloads slide                     |
| 8   | No re-probe; no TTY guard on the wizard path                      | `setup-shell.tsx`, `main.ts:1090`                     |

## Testing

Beyond unit coverage of the new pure pieces, three gates:

1. **Write-map conformance.** A test asserting every value the wizard collects is
   written to config, and every config key it writes is read somewhere. CLAUDE.md
   names silent no-ops the house failure mode and
   `test/unit/architecture/contract-conformance.test.ts` already gates this
   class — the wizard joins it. This is the structural answer to "won't bite us
   later"; a checklist is not.
2. **Frame captures.** `test/harness/capture-setup.tsx` extends to all seven
   screens at 72 / 100 / 140 columns, committed under `test/__captures__/`, so
   layout breaks show up in a diff.
3. **Resolver ranking.** Table-driven test over synthetic PATH listings —
   newest-wins, desktop-over-mobile, tor excluded, plain-curl fallback, empty
   PATH — so the resolver cannot silently regress to a stale pick again.

## Out of scope

- Theme picking. The design mockup shows a Sakura/Hearth/Ember picker; only
  Sakura exists in `packages/design`. Adding a theme system is its own plan.
- Relay configuration. User-owned and empty by default; belongs in `/settings`.
- Any change to the analytics payload, endpoint, or ingest. Only the consent
  screen's copy and default selection move here.
