# Kunai — Brand System

> Terminal-first. Fox-fast. Finds the playable stream and gets out of the way.

## 1. Strategy

|                 |                                                                                    |
| --------------- | ---------------------------------------------------------------------------------- |
| **Category**    | Terminal-first streaming CLI (anime · series · movies)                             |
| **Audience**    | Keyboard-native power users; anime/TV watchers who live in the terminal            |
| **Promise**     | Precision: one sharp strike to the playable stream — no browser, no clutter        |
| **Personality** | Sharp, warm, fast, quietly premium, a little mischievous (kitsune)                 |
| **Avoid**       | Corporate SaaS gloss, neon-purple "AI" glow, busy dashboards, cute-for-cute's-sake |

**Core metaphor — the name _is_ the brand.** "Kunai" is the ninja blade; the maker is _kitsune_ (fox). The identity fuses both: a **kitsune that throws kunai** — precise, fast, finds its mark. Anime is the heart; the fox is the soul; the blade is the verb.

## 2. Logo

**Mark** (`kunai-mark.svg`) — a single geometric shape that reads two ways at once: a **fox face** (two ears, two eyes, tapering chin) _and_ a **kunai blade** (the ears are the blade shoulders, the chin is the point, a forged-edge facet runs down the centre). Inner-ear "sparks" in cream. One color (rose) so it scales to a favicon.

**Wordmark** — `KUNAI` in a monospace/geometric face, wide letter-spacing (`0.18em`), the mark to its left at cap height. Lowercase `kunai` is fine in body/CLI contexts (`🦊 Kunai`).

**Clear space:** one ear-height on all sides. **Min size:** mark 16px, wordmark 80px wide.

**Don't:** recolor the mark outside the rose family · add gradients/bevels · stretch · place the eyes on a busy photo without a scrim.

## 3. Mascot

`kunai-mascot.svg` (static) and `kunai-mascot-animated.svg` (idle blink + gentle bob). A 16×14 pixel-art kitsune bust — same lineage as the Claude Code terminal creature, but a fox: two pixel eyes, cream cheeks + muzzle, rose fur, deep-rose outline. Source of truth is the ASCII grid in `generate-mascot.mjs`; edit a cell and regenerate.

- **README banner / terminal splash:** static SVG (animation is stripped by GitHub's sanitizer — for an animated README use the GIF from the image prompt).
- **Docs site / browser:** animated SVG is fine and animates natively.
- The mascot is the warm, friendly face; the **mark** is the sharp, professional one. Use mascot for onboarding/empty states/banner; mark for favicons/headers/badges.

## 4. Color — "Ember Dusk" (proposed token redesign)

Rationale: the current Sakura ramp is all one rose-brown hue with tiny steps (no elevation hierarchy), the brand accent collides with the anime kind-color, and there is no cool hue — so it reads flat. Ember Dusk keeps the warm-dusk soul but: (a) a **near-neutral warm-ink ramp** with visible elevation steps, (b) **rose reserved for brand/focus/selection only**, (c) **nine evenly-spread hues** so every signal is distinct, including a cool **info-blue** for temperature contrast.

### Neutrals (≈90% of the UI)

| token           | hex                | role                  |
| --------------- | ------------------ | --------------------- |
| bg              | `#100b0f`          | app canvas            |
| surface         | `#1c1620`          | panels                |
| surfaceElevated | `#2a2030`          | cards / raised        |
| surfaceActive   | `#3a2b40`          | **selected row band** |
| line            | `#473b51`          | borders               |
| lineSoft        | `#281f2e`          | hairline dividers     |
| lineStrong      | `#62526c`          | strong dividers       |
| scrim           | `rgba(8,5,9,0.66)` | overlay dim           |

### Text

| token   | hex       |
| ------- | --------- |
| text    | `#f6eff4` |
| textDim | `#cabfca` |
| muted   | `#968a98` |
| dim     | `#665b69` |

### Brand accent — rose (focus · selection · brand · primary action ONLY)

| token      | hex                            |
| ---------- | ------------------------------ |
| accent     | `#ff8fb0`                      |
| accentSoft | `#ffc6d8`                      |
| accentDeep | `#d85f86` (progress fill)      |
| accentDim  | `#7e3350`                      |
| accentFill | `#2c1622` (selection/badge bg) |
| accentGlow | `rgba(255,143,176,0.10)`       |

### Semantics (status only — each its own hue)

| token     | hex       | token         | hex       |
| --------- | --------- | ------------- | --------- |
| ok        | `#54d6a0` | okFill        | `#122a22` |
| warn      | `#f59a3c` | warnFill      | `#2e2012` |
| danger    | `#ff5d5d` | dangerFill    | `#341515` |
| info      | `#5fb6ff` | infoFill      | `#112230` |
| milestone | `#8b7bf0` | milestoneFill | `#1c1830` |

(`okDim #3a9a78`, `warnDim #b06f28`, `dangerDim #a02b2b`, `infoDim #3c7fbf`, `milestoneDim #4a417c`.)

### Content kinds (tags / dots — distinct from brand & semantics)

| token      | hex       | hue     |
| ---------- | --------- | ------- |
| typeAnime  | `#c98bff` | orchid  |
| typeSeries | `#4fd1c5` | teal    |
| typeMovie  | `#f4c45c` | gold    |
| typeMixed  | `#968a98` | neutral |

### ANSI-256 fallbacks (low-color terminals)

bg `#121212` · surface `#1c1c1c` · elevated `#262626` · active `#303030` · accent `#ff87af` · accentDeep `#d75f87` · ok `#5fd7af` · warn `#ffaf5f` · danger `#ff5f5f` · info `#5fafff` · milestone `#875fff` · anime `#af87ff` · series `#5fd7d7` · movie `#ffd75f`.

### Hierarchy rule

Color is **earned**. Neutrals carry structure; **one** rose accent marks where you are; semantics mark state; kind-colors tag content. Never two accents competing in one row. A screen that's mostly neutral with a few decisive color hits is the target — that restraint is the premium feel.

**Adoption:** edit `packages/design/src/tokens.ts` + `color-resolution.ts`, regenerate terminal snapshot captures. This is its own implementation slice (it touches the whole CLI) — see the open decision in the initiative roadmap. The one identity call: **anime moves from rose to orchid** so it stops colliding with the brand accent (brand stays rose; the fox stays rose).

## 5. Voice

Short, precise, a little dry. "Finds the playable stream." "Nothing fabricated." "Airs today." Never marketing fluff, never fake hype. Lowercase command-line cadence in-app; Title Case for surface headers.

## 6. Asset index

- `kunai-mark.svg` — logo mark (fox + blade)
- `kunai-mascot.svg` / `kunai-mascot-animated.svg` — pixel kitsune
- `generate-mascot.mjs` — mascot source (ASCII grid → SVG)
- `palette-board.mjs` → `palette-current.svg` / `palette-proposed.svg` — token comparison board
- `kunai-brand-system.md` — this file
- `image-prompts.md` — raster prompts for hero/OG/GIF (run via nano-banana / codex / cursor)
