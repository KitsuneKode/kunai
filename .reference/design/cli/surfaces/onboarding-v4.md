# Onboarding v4 — install to first frame

Board: [`../kunai-onboarding-v4.html`](../kunai-onboarding-v4.html). Every state is drawn cell for
cell at 100×30 and 54×25, with the 40×16 floor for setup. Colours are the live tokens in
`packages/design/src/tokens.ts`; the Sakura rose palette is kept.

This file is the plain-text half of the board: what changed and why, the step counts, and the
exact copy. If the shipped UI and this file disagree, the code is right and this file is the bug.

## The problem

Four reviewers scored onboarding 6/10. Measured on `main` in a fresh sandbox profile
(`bun run agent:session -- start --seed fresh`):

- Setup is six screens (machine, mode, language, playback / downloads / accounts, usage ping,
  summary) and asks 18 settings before the first stream.
- `kunai -q -S "Dune"` on a fresh install runs all six screens first.
- After setup, Browse lists picks with focus on the list under a visible search field, so a
  typed query lands on a recommendation.
- On a cold cache Browse shows a static "welcome to kunai" screen that takes no typing until the
  catalog answers.
- At 54×25 the consent screen overflows: its title and both option labels are pushed out of the
  frame. At 40×16 every setup screen overlaps itself.
- A first failed stream says "Playback failed / An unknown error occurred".

## Step counts

|                                                             | Before                     | After |
| ----------------------------------------------------------- | -------------------------- | ----- |
| Setup screens before Browse                                 | 6                          | 2     |
| Keystrokes to leave setup, declining analytics              | 6                          | 2     |
| Settings asked before the first stream                      | 18                         | 2     |
| Screens between `kunai -q -S "Dune"` and the player (fresh) | 6                          | 0     |
| Time Browse refuses typing on a cold cache                  | until the catalog answers  | none  |
| Consent screen at 54×25                                     | title and labels clipped   | fits  |

Two journeys, both without docs:

1. `install` → `kunai` → **1⁄2** what you watch → **2⁄2** usage ping → Browse with the cursor in
   the field → results → player.
2. `install` → `kunai -q -S "Dune"` → player. A launch that names what to play is not
   interrupted. Setup waits for the next bare `kunai`; analytics stays `unset`, which is off.

## What changed, and why

**Setup is two screens on a first run.** The machine check and the mode question merge into
screen one. The check collapses to a single verdict line, because "can this machine play?" is one
fact, not six rows. The verdict follows the highlighted lane: `curl-impersonate` is mentioned only
to someone about to choose anime, `yt-dlp` only to someone about to choose YouTube. The old table
is one key away (`d`).

**Language, playback toggles, downloads and accounts are deferred.** They keep the values the
config already has. `/setup` and `kunai --setup` walk the six shipped screens, unchanged, and `m`
on screen one joins that flow at language. Asking for setup means wanting all of it; being
ambushed by it on first launch does not.

**The summary screen is gone from the first run.** Setup ends in Browse with one line saying it
was saved. The review screen stays in the full flow, where there is something to review.

**A launch with a destination skips setup.** `-S`, `-i`, `--continue`, `--history`, a share link
and the other explicit routes go where they were told. Nothing is written, so the next bare
`kunai` still offers setup.

**The consent screen keeps its contract and gains a layout.** See the next section.

**Browse is ready to type.** The search field owns the keyboard on arrival. Startup picks are
mounted, not awaited, and when they land they never take focus from the field. While they load,
the field is live and three commands are offered.

**No player has one message.** What is missing, the one command for this OS, and the key that
re-checks — on setup screen one, in the installer's last lines, and in the play-time failure.

**A failure names the next step.** The panel order is fixed: what failed, `Next`, then the
evidence. The sentence is the one the failure classifier already writes. `Next` never names a
key the panel does not have. The keys are the ones the panel already had (`r`, `p`, Enter / Esc).

## The consent screen: what is fixed in place

Read with `.docs/analytics-privacy-contract.md`. Nothing here loosens it.

- It is still its own screen, the last one of setup. It was not folded into a default.
- No row is pre-selected and neither is marked recommended. The cursor starts on no row.
- Enter does nothing until an arrow has chosen a row. Enter on "Share anonymous usage" is the
  only keystroke that can record `enabled`.
- `s` is "don't share". `S`, `m` and `p` choose nothing here. A pointer cannot grant consent.
- Leaving without answering (esc, a launch that skipped setup, a non-TTY run) records
  `unchanged`: no `installId`, no send, and no silent opt-out of someone who had opted in.
- The payload preview is still `describePayload()` itself.

What changed is fit, and one consequence of being last. Below 70 content columns the two option
details use their short form and the payload wraps to the frame instead of to a fixed 60
columns. At the size floor (under 44 content columns, or too few rows for the narrow layout) the
preview is the payload's field names, read from the same object, and every line truncates
instead of wrapping: a setup screen that is too tall does not scroll, it drops rows, and on
`main` the rows it dropped were the title and an answer. `p` opens the values as a view of their
own; while it is open the answers are off screen, so every key only closes it.

In the two-screen flow the consent screen is the last one, so the keystroke that answers it also
finishes setup. The answer is passed to the finish call directly rather than read back from
state, so the committed value and the written value cannot differ.

## Exact copy

### Installer, last lines

```text
Done.
Watch something:
  kunai -q -S "Dune"     search and play in one step
  kunai                  browse, with a two-question setup

Update any time:  kunai upgrade
Remove:           kunai uninstall
```

No player: `No video player found — Kunai needs mpv or VLC to play anything.` VLC but no mpv:
`mpv is not installed — with the default player setting (auto), Kunai will play in VLC. mpv is optional.` The command offer that follows
is unchanged.

### Setup 1⁄2 — context `welcome`

```text
❀  What do you watch most?
   Sets where Kunai starts. Tab switches lanes any time.

▌ Shows & movies
    TMDB catalog, series and films
  Anime
    AniList catalog, sub and dub
  YouTube
    Search and play from YouTube

✓ Ready to play in mpv

Language, downloads and accounts start on their defaults.
m sets them now · /setup changes them any time
```

Footer: `[enter] continue  [↑↓] choose  [d] this machine  [m] more setup  [esc] quit`.
When something needs attention: `[r] recheck  [enter] continue  [↑↓] choose  [d] this machine  [esc] quit`.

Verdict lines:

| State                           | Copy                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| mpv present                     | `✓ Ready to play in mpv`                                                                                                             |
| VLC only                        | `✓ Ready to play in VLC`                                                                                                             |
| no player                       | `✗ No video player found — nothing can play yet` · the command · `Run it in another terminal, then press r. VLC works too.`           |
| anime lane, no curl-impersonate | `△ Anime search can come back empty here` · the command · `Cloudflare turns away plain requests. Shows & movies are not affected.`    |
| YouTube lane, no yt-dlp         | `△ YouTube needs yt-dlp` · the command                                                                                               |
| re-checking                     | `Checking this machine again…` (the title petal blooms)                                                                                                   |

Narrow sub line: `Sets where Kunai starts. Tab switches later.` Narrow no-player hint:
`Install it, then press r. VLC works too.` At 40 columns lane details and the defaults note are
dropped; the three lanes and the verdict never are.

### Setup 1⁄2 · `d` — context `this machine`

Title `This machine`, sub `What Kunai found, and the one command for anything missing.` The rows
are the dependency table as before. Footer: `[d] back  [r] recheck  [↑↓] choose`. Any other key
returns to the lanes; the quit key leaves the view, not setup.

### Setup 2⁄2 — context `usage ping`

Unchanged at 100 columns. Short forms below 70 content columns:

```text
Share anonymous usage with Kunai?
Nothing is sent unless you choose to share.

  Share anonymous usage
    One ping a day. Counts installs, not people.
  Don't share
    No network calls. No install id on disk.
```

### First Browse

- On the shell's transient row for ten seconds: `Setup saved · /setup for language and more`
- Hint under the field, picks listed, field empty: `Type a title, then enter · ↓ picks`
- Hint while startup picks load: `Type a title, then enter · no need to wait`
- Cold cache, in place of the list:

```text
❀  Finding something to watch…

Or start here
  /trending  what is popular this week
  /calendar  what airs today
  /random    pick something for me
```

- Picks never arrived: `No picks to show right now` /
  `Type a title to search. No connection? Check it, then run /discover.`

### No results

```text
· No results for "frieren" in shows & movies
Press Tab to search anime instead, or try fewer words.
```

In anime mode the second line reads `Press Tab to search shows & movies instead, or try fewer words.`
A known cause (a provider that threw, TMDB unreachable) still replaces the second line.

### Failure panel

Heading stays `Playback failed`. Then the classifier's sentence, or `The stream did not start.`
when there is none (it used to read `An unknown error occurred`). Then `Next`.

| Cause                                 | Next                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| no stream from the source             | `press p and pick another source`                                                             |
| offline / network                     | `check your connection, then press r to try again`                                            |
| blocked, rate-limited (CAPTCHA)       | `press p and pick another source` · `To fix it for good, install curl-impersonate:` · command |
| no player                             | `install a player, then press r` · command                                                    |
| yt-dlp missing                        | `install yt-dlp, then press r` · command                                                      |
| stream expired, player stuck or gone  | `press r — Kunai fetches a fresh stream`                                                      |
| provider needs a session              | `press p for another source, or add the session in /settings`                                 |
| anything else                         | `press r to try again, or p to pick another source`                                           |

The curl-impersonate lines appear only on a machine without it. Without a source picker the `p`
half is dropped; without retry the step reads `press Enter to go back and try again`. Last row,
unchanged: `r retry  ·  Enter / Esc dismiss`.

## Variants

- **`--plain`**: no borders, glyphs or selection band. Selection is `[selected]`, the verdict is
  `[ok]` / `[warning]` / `[missing]`. On the consent screen neither row carries `[selected]`
  until an arrow is pressed.
- **40×16**: lane details, the companion, the defaults note and the footer's surface label go
  first. The three lanes, the verdict and both consent rows never do.
- **`NO_COLOR`**: nothing on these screens is carried by colour alone. Selection has the `▌`
  rule, state has its glyph and its words. The board's `NO_COLOR` button shows every frame so.
- **Reduced motion**: the only motion in setup is the petal while `r` re-probes. With reduced
  motion it is a still petal and `Checking this machine again…` carries the state.
- **Mouse and tap**: every lane row, footer key and consent row keeps its target. Clicking a
  consent row moves nothing: consent is keystroke-only.

## Not in this pass

- A one-line exit message naming where playback stopped and `kunai --continue`. Drawn on the
  board as proposed.
- The header's `series · vidlink` context during setup, which says nothing to someone who has not
  chosen yet.
- VLC's dependency row, the recheck that keeps a VLC session, and the single mpv/VLC capability
  rule come from the base branch (`fix/pretag-scorecard-2026-11-27`); this work reads them.
- The play-time sentence that still opens with "mpv is required for playback". `Next` now names
  "a player" beside it, but the sentence itself is unchanged.
- An offline-aware version of "No picks to show right now". Discover swallows its own network
  errors, so Browse cannot yet tell "offline" from "nothing to recommend".
- The "Next up" home row: PR #847.
