# Kanna — voice, reactions, and presence

Remaining work on the mascot after [#285](https://github.com/KitsuneKode/kunai/pull/285)
landed the asset pipeline and the first voice line. This plan owns the
_personality_: what she says, when she reacts, and what each surface is allowed
to do. The character art itself is owned by
[kanna-art-brief.md](../.reference/design/brand/kanna-art-brief.md).

## The one rule everything else follows

**Personality lives in the copy tier. Art is a bonus tier.**

The illustrated fox needs a graphics protocol, which means Kitty, Ghostty,
iTerm2 or WezTerm — a minority of runs. Copy reaches every terminal, every
SSH session, every CI log. So the character has to be legible with the picture
switched off, and the picture is what a capable terminal gets _on top_.

The first version of this had it backwards: the fox carried all the personality
and everyone else got a static 🦊. Do not drift back.

Three tiers, and every surface must decide for all three:

| tier       | reach                                      | carries                       |
| ---------- | ------------------------------------------ | ----------------------------- |
| `off`      | `KUNAI_PET=off`, and all redirected output | nothing at all                |
| `glyph`    | every terminal                             | the voice line, the 🦊 marker |
| `graphics` | kitty · ghostty · iterm2 · wezterm         | the above, plus the still     |

## Shipped

- `kanna-voice.ts` — pure line selection, `empty` and `error` moments
- `StateBlock` renders one line on those two kinds, across 16 mount sites
- `companionMode()` — `graphics` / `glyph` / `off`, non-TTY resolves to `off`
- Docs: pointer lean, pose cross-fade, copy-reward hop, nav and sidebar hover

## Remaining

### 1. The rest of the voice

Today the pools cover `empty` and `error`. The moments that still have no line,
in rough order of how often a person meets them:

| moment      | fires when                           | tone                                   |
| ----------- | ------------------------------------ | -------------------------------------- |
| `searching` | a query goes out                     | brief, unbothered                      |
| `resolving` | providers are being tried            | matter-of-fact, names progress         |
| `dead-end`  | one provider fails, others remain    | shrugs, moves on                       |
| `found`     | a playable stream resolves           | quietly pleased, never triumphant      |
| `handoff`   | mpv takes over                       | hands off and leaves                   |
| `resume`    | picking up mid-episode               | remembers without making a thing of it |
| `first-run` | setup, once                          | welcoming, still brief                 |
| `goodbye`   | exit                                 | warm, three words                      |
| `offline`   | no network                           | states it, offers the offline library  |
| `slow`      | a resolve passes the stall threshold | acknowledges the wait                  |

Rules, enforced by `kanna-voice.test.ts`:

- one line, ≤ `LINE_BUDGET` (48) characters
- no exclamation marks, no emoji in the copy, no second sentence
- unique within a pool, at least three variants per moment
- fires on a **state transition**, never on a timer

Voice check: she is competent and brief, and she is never excited. Her range is
calm → focused → mildly put-out. If a line would sound wrong said flatly by
someone who has done this a thousand times, it is the wrong line.

Draft lines worth stealing:

```
searching  "on it."                    "sniffing around."
resolving  "a few providers deep."     "checking which mirrors are awake."
dead-end   "that one's a dead end."    "mirror's down. next."
found      "got one, and it plays."    "this one's good."
handoff    "over to mpv."              "it's yours."
resume     "picking up where you left off."
slow       "this one's being slow about it."
offline    "no network. your library still works."
goodbye    "see you."                  "go rest."
```

### 2. Reactions in the terminal

Animation in a graphics terminal means re-uploading the image every frame,
which flickers, costs bandwidth over SSH, and fights Ink's full-frame repaint.
So the still stays still and **the motion is in the character cells beside it**
— a few bytes of diff per frame instead of a re-upload.

Reuse the existing motion primitives rather than inventing a second policy:
`useFrameTick(active, intervalMs, stopAfter)` and `reducedMotionEnabled()` in
`primitives/SakuraPetal.tsx`. `stopAfter` is what makes a one-shot reaction
possible without leaving a timer running.

| reaction                     | mechanism                                                  | cost     |
| ---------------------------- | ---------------------------------------------------------- | -------- |
| ear twitch while idle        | 3-frame glyph cycle beside the still, 900ms                | 1 cell   |
| tail flick on a state change | one-shot 4-frame cycle, `stopAfter: 4`                     | 1 cell   |
| pose swap on transition      | new still, on meaningful moments only                      | 1 upload |
| line typing on               | reveal the quip a few characters at a time, ≤300ms         | 1 row    |
| settle on success            | glyph goes still and mint, matching `SakuraPetal` complete | 1 cell   |

The signature reaction should be the **ear twitch**, because it is the one that
reads as alive while costing a single cell, and it works identically in the
glyph tier where there is no fox at all.

**Do not** replace the ❀ sakura loader. It is the documented brand motif
(`.reference/design/cli/kunai-sakura.html`) and `SakuraLoader.tsx` states a
one-motion-policy rule. Kanna speaks through its `sublabel`, beside it.

### 3. Pose → state mapping

Wire once the consistent pose sheet exists. Until then every pose falls back to
the two the current art supports.

| state                    | pose    |
| ------------------------ | ------- |
| at rest, setup           | `idle`  |
| searching, resolving     | `seek`  |
| stream found, handoff    | `carry` |
| playback running         | `watch` |
| provider dead, no result | `oops`  |
| exit, idle timeout       | `nap`   |

### 4. Novelty decay

The full character on first run; the bust crop on every run after. A companion
that is the same size on run 300 as on run 1 stops being charming and starts
being furniture. This is a real requirement, not a nicety.

### 5. What needs the art first

Blocked on a consistent pose sheet landing:

- per-part motion on the docs site — ear flick, blink, pupil tracking. These
  need addressable parts, which means tracing Kanna to SVG. A flat raster can
  only move as one piece, and slicing eyes out of it per pose breaks on every
  re-export.
- the `seek` / `carry` / `nap` / `oops` poses above
- a `peek` crop for the sidebar and section rules

### 6. The Kanna page

`docs/users/kanna.mdx` — who she is, the pose sheet, what each state means, and
how to turn her off. The "turn her off" section is not an afterthought:
developers trust a project more when it tells them plainly how to disable the
cute thing.

## Guardrails

- `KUNAI_PET=off` silences **everything**, copy included. It is the way out and
  it must never become partial again.
- Nothing decorative in non-TTY output. A redirected run gets no glyph, no line.
- Every reaction gated on `reducedMotionEnabled()`.
- No sound in the CLI, ever. No portable path, breaks over SSH, and it fires in
  someone's open-plan office. The docs site may have exactly one opt-in chirp.

## Acceptance

- Every moment in §1 has ≥3 lines, all inside the budget, all passing the voice
  test
- The glyph tier alone reads as a character with the picture disabled
- A full session start → search → resolve → play → quit shows at most **four**
  companion lines. If it shows more, she is chattering, and the fix is deletion.
