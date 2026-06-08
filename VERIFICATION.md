# Kunai Verification

Last updated: 2026-06-08

This is the single canonical verification checklist for Kunai.
Add new runtime, UX, provider, and shell verification work here instead of creating per-area
checklists in other folders.

It separates:

- what is already implemented in code
- what needs a real manual smoke run soon
- what can be deferred until the broader beta-feel pass

## Landed Runtime Work

### Playback controller and autoplay

- `PlaybackSessionState` now models:
  - `manual` vs `autoplay-chain`
  - session-local autoplay pause
  - stop-after-current
- live playback controls now exist:
  - `q` stop current playback
  - `n` next episode
  - `p` previous episode
  - `a` pause/resume autoplay for the current chain
  - `x` stop after current
  - `r` refresh current source
  - `f` fallback provider
  - `s` reload subtitles
  - `b` skip the active recap/intro/preview segment when one is active
  - `o` open source picker and replay with selected source
  - `k` open quality picker and replay with selected quality (also mapped in mpv bridge)
- autoplay defaults to `on`
- manual quit near end is credits-aware when IntroDB timing exists
- fallback completion threshold is the last `5s` when timing metadata is absent

### Persistent mpv session

- autoplay chains now reuse one `mpv` process
- episode-to-episode advance uses the persistent player session path
- `next` / `previous` / `refresh` / `fallback` now prefer stopping the current file instead of killing the whole player when possible
- the persistent player is released before post-playback menus and on phase teardown

### Subtitle behavior

- configured language is re-selected from the full inventory before playback
- built-in/provider-native subtitles are preferred over external subtitles for the same language
- all extra subtitle tracks are still attached for in-player switching
- subtitle source metadata is preserved for picker/detail display
- cached subtitle links remain part of the cached stream payload until the user explicitly refreshes subtitles

### IntroDB timing integration

- credits timing influences completion/near-end behavior
- recap / intro / preview timing is now available to the player auto-skip path
- skip defaults are now part of config:
  - `skipRecap`
  - `skipIntro`
  - `skipPreview`

### In-flight cancellation

- playback resolve work now registers as active cancellable work
- the playback loading shell now shows `Esc to cancel`
- cancelling playback resolve returns to results instead of leaving background work running
- phase-level abort signals now flow through search/provider/timing calls

### Playback HUD polish

- the playback shell now distinguishes:
  - resolving provider stream
  - checking episode timing
  - launching player
  - opening stream
  - attaching subtitles
  - player active
- skip actions now surface visible notes like `Intro skipped automatically`

## Study Group S01E02 smoke (Cineplay / Videasy gate)

Canonical title: **Study Group** `tmdb=233347`, season 1 episode 2. Run after cache or provider changes.

| Step | Action                                                               | Expected                                                      |
| ---- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1    | Purge episode cache (`/commands` → purge or delete inventory row)    | No stale ORG-only ladder                                      |
| 2    | Play S01E02 with Videasy/VidKing default                             | `Playing` within ~30s; mpv shows video                        |
| 3    | Press `o` during bootstrap or playback                               | Source picker shows **Neon** + 3 qualities (1080p/720p/ORG)   |
| 4    | Stall bootstrap or network read; press `r` / `f` / `d` from terminal | Recover, fallback, or diagnostics without quitting            |
| 5    | Let autoplay advance to S01E03 (if released)                         | Auto-next respects released-only prefetch                     |
| 6    | Open diagnostics during/after resolve                                | Route/host visible; startup phase breakdown after first frame |

**Last automated gate (2026-06-08):** unit + typecheck + lint pass; manual mpv smoke **pending** on this machine.

```sh
bun run dev -- -i 233347 -t series
# navigate to S01E02, or use direct episode flags when available
```

## Manual Verification To Run Soon

These are the highest-value smoke checks to do next.

### Playback chain

1. Start a series episode with autoplay enabled.
2. Let it reach natural EOF.
3. Confirm the next episode starts in the same `mpv` session without a full visible respawn.
4. Confirm subtitle inventory is reattached on the next episode.

### Live controls

1. During playback press `n`.
2. Confirm the current file stops and the next episode loads in the same session.
3. Repeat with `p`.
4. During playback press `x`.
5. Confirm autoplay stops after the current episode ends.
6. During playback press `a`.
7. Confirm the chain pauses/resumes without changing saved config.

### Resolve cancellation

1. Start an episode that takes a noticeable amount of time to resolve.
2. While the shell shows resolving/loading, press `Esc`.
3. Confirm Kunai returns to the results state.
4. Confirm no stale loading state remains visible.

### Subtitle priority

1. Pick a title that exposes both built-in and external subtitles for English.
2. Confirm English is selected by default.
3. Confirm the selected default is the built-in/provider-native track.
4. Confirm other tracks are still available inside `mpv`.

### Skip timing

1. Play a title with IntroDB timing.
2. Confirm recap/intros/previews auto-skip when enabled.
3. During one of those windows, press `b`.
4. Confirm manual skip jumps to the end of the active segment.
5. Confirm credits timing affects completion/auto-next behavior as expected.

### Source and quality controls

1. Start playback on a provider exposing multiple streams/variants.
2. Press `o` in the loading/playback shell and pick a different source.
3. Confirm playback restarts with resume position and selected source.
4. Press `k` in the shell, then again from mpv (`K`).
5. Confirm quality picker appears and replay uses the selected variant.

### Poster rendering

1. Browse several results with posters in Kitty or Ghostty.
2. Confirm poster preview renders consistently without stale/dead image placeholders.
3. Confirm switching results does not leave orphaned image content behind.
4. Confirm fallback text/image behavior remains usable on non-graphics terminals.

## Good To Defer Until Beta Feel Pass

These should be verified later in a longer manual pass instead of blocking iteration now.

- long multi-episode autoplay chains across season boundaries
- live provider fallback under flaky network conditions
- real-world subtitle source consistency across multiple providers
- poster/image behavior across Kitty, Ghostty, and fallback terminals under long sessions
- end-to-end `browse -> play -> quit -> resume -> next series` flow feel

## Known Remaining UX Layer Work

These are not correctness blockers, but they are still worth doing.

- richer on-screen playback copy for active skip windows before an auto-skip fires
- optional command-palette surface for skip actions
- wiring the same active cancel control into more non-playback loading flows where it makes sense
- broader beta QA with real providers and real terminal environments

## Quick Commands

Run before and after manual runtime checks:

```sh
bun run typecheck
bun run test
bun run lint
bun run fmt
```
