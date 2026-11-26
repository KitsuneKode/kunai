---
status: active
created: "2026-11-27"
lastReviewed: "2026-11-27"
---

# Plan: v0.4.0 launch, and a reason to come back

## Status

- **Status:** IN PROGRESS. The pre-release code fixes are in PRs (#843
  hardening, #844 `--player auto` falls back to VLC). This plan holds what
  is left.
- **Inputs:** three independent reviews on 2026-11-27: Gemini 4 Neon
  (engineering), GPT-6.2 Sol and Grok 4.7 (growth and retention). Every item
  below was checked against the code before being listed. Findings the
  reviewers got wrong are noted at the end.
- **Owns:** the launch sequence and the retention work. Provider health and
  defaults stay in the [road to 9.5](./2026-11-24-road-to-9-5.md).

## What all three agree on

The one thing worth showing is the failover that already shipped: a stream
dies and playback continues on the next source at the same moment, in the
same window. ani-cli, MovieBox-TUI and streambert cannot copy that with a
script. Everything else either gets a stranger to that moment faster or
brings them back the next day.

## Launch sequence (maintainer-owned steps marked)

1. **Merge the in-flight PRs** (#843, #844, this README pass) before the tag.
2. **Tag v0.4.0, then wait for the release metadata PR** (maintainer). Until
   it merges, `Formula/kunai.rb` and `bucket/kunai.json` still install
   v0.3.0, so nothing may announce `brew` or `scoop` before then.
3. **Record a 20-second failover clip** (maintainer). Use owned or generated
   media and two controlled endpoints. Keep autoplay on (same-window reuse
   needs `autoplay-chain`), play a series, kill the first source, and show
   the OSD switch with the same timestamp. End on `Ctrl+Shift+S`. Put the clip
   first in the README, above the install block.
4. **Post once:** r/commandline, then a Show HN, then X. The post is the clip,
   one sentence, the privacy line and the disclaimer. Do not name upstream
   sites, claim Stremio parity, or show Termux before a device pass.
5. **Release every two weeks**, even when a provider was demoted. Name the
   demotions in the notes.

## Retention work (code, in order)

1. **Home row that survives a finished episode.** When the newest history
   row is completed, show the next episode ("next up") instead of nothing.
   Use the same unfinished anchor `--continue` already picks
   (`apps/cli/src/services/continuation/ContinueWatchingService.ts`), and
   the history persist floor (10 s) instead of the 30 s engage floor
   (`apps/cli/src/app-shell/browse-idle-context.ts`,
   `apps/cli/src/domain/playback/progress-engage-policy.ts`).
2. **Follow on the first real watch.** On the first history write past 30 s,
   follow the title unless it is muted, and stamp `lastCalendarVisitAt` if it
   is still 0, so "new episodes since you left" can appear without a calendar
   visit. `/unfollow` and `/mute` stay the way out. No network call.
3. **An empty Discover on a cold cache** gets a search action instead of a
   spinner (`RecommendationServiceImpl` returns an empty section with no
   prior cache).
4. **Carry the chosen audio track across failover** (#677). Subtitles already
   carry over.
5. **Legitimate sources:** play a file you already have, with history and
   resume, then a small rights-checked Internet Archive adapter behind
   `verifyCandidateStream`. These are better launch paragraphs than another
   scraper.

## Agreeable paths

- Grow on the channels that already exist: the signed installers, the
  Homebrew tap, Scoop, the AUR `kunai-bin` recipe, npm. Do not open Homebrew
  core, WinGet, Flathub or a store listing while the binary ships scrapers.
- Position Kunai as "a terminal shell that finds a direct stream and keeps
  playing it in mpv or VLC when that stream dies", with the disclaimer right
  under the clip.
- Privacy is a sentence, not a pipeline: nothing is sent unless the user
  picks it on a screen where neither row is pre-selected. Measure with
  GitHub's public download counts and the existing opt-in ping only.
- Contributors start with "a title that will not start, with `kunai doctor`
  and a redacted export", not with new sources in public issues.
- Discord: register one application so "Play on Kunai" can exist, and leave
  presence off by default (maintainer).

## Rejected after verification

- "Revision 3–5 Videasy re-picks are overwritten" (Neon): the Videasy
  migration was introduced at revision 6, so those configs are unmigrated,
  not re-picked.
- "Live provider health should not gate the release" (plan text) versus the
  release workflow that requires a fresh signoff artifact: keep the gate for
  v0.4.0 (Sol).
