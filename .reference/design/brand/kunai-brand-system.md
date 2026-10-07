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

The illustrated kitsune is the warm face. Raster masters live in `ip-as-logo-batch/` (A Operator, B Courier, C Watcher). The live character is the hand-simplified SVG in `apps/docs/components/brand/kunai-fox.tsx`:

| pose  | batch | use                              |
| ----- | ----- | -------------------------------- |
| wait  | A     | empty, waiting, sidebar          |
| go    | B     | search, loading, install banners |
| watch | C1    | 404, mischief, docs hub          |
| idle  | C2    | home, OG, nav, companion default |

Docs animate with CSS (`apps/docs/app/styles/fox.css`); `prefers-reduced-motion: reduce` freezes on the pose. Favicons, badges, and header chrome keep the **mark**. CLI headers keep `🦊 Kunai`. On Kitty/Ghostty/iTerm/WezTerm the same rasters render as a companion pane (`KUNAI_PET=off` retires her, `KUNAI_PET=glyph` pins 🦊; half-block is skipped because this art turns to noise at two pixels per cell).

The old `generate-mascot.mjs` pixel-grid generator was removed; `kanna-bust.svg` is the source of truth.

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
| lineControl     | `#786782`          | **control edge** (inputs, outlined buttons, toggles): 3:1 on every surface |
| scrim           | `rgba(8,5,9,0.66)` | overlay dim           |

### Text

| token   | hex       | APCA \|Lc\| on canvas | role                                |
| ------- | --------- | --------------------- | ----------------------------------- |
| text    | `#f6eff4` | 98                    | primary text                        |
| textDim | `#d5cad5` | 76                    | body-weight secondary text          |
| muted   | `#bcafbe` | 61                    | labels and metadata                 |
| dim     | `#a292a5` | 46                    | hints and pending steps             |
| faint   | `#3a3340` | decorative            | rules and disabled glyphs, not text |

The tiers were set by lightness only (hue and chroma held) to meet APCA targets of 75, 60
and 45 on the canvas and panel. On the selected row they land at 71, 56 and 41. The previous
values (`#cabfca`, `#968a98`, `#665b69`) were 70, 41 and 20, and the old `dim` fell to 15 on the
selected row. Terminal 256-colour fallbacks live in `packages/design/src/color-resolution.ts`.

`text`, `textDim` and `muted` are body-readable (4.5:1) on every surface, including the selected-row band. `dim` is **disabled or decorative only** (2.8:1 on `surface`); never put a sentence in it.

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
| milestone | `#6d85f6` | milestoneFill | `#151a32` |

(`okDim #3a9a78`, `warnDim #b06f28`, `dangerDim #a02b2b`, `infoDim #3c7fbf`, `milestoneDim #39467f`. The `*Dim` steps are fills, bars and borders; they are not text colours.)

### Content kinds (tags / dots — distinct from brand & semantics)

| token      | hex       | hue     |
| ---------- | --------- | ------- |
| typeAnime  | `#d885f1` | orchid  |
| typeSeries | `#4ad0cf` | teal    |
| typeMovie  | `#ebc95c` | gold    |
| typeMixed  | `#968a98` | neutral |

### 1.1 refinements (measured, not restyled)

The brand, the surface ramp and the rose accent are unchanged. Every change below fixes a number that was measured, in OKLCH, against the surfaces the colour actually renders on:

| change | before | after | why |
| --- | --- | --- | --- |
| `muted` | `#968a98` | `#a195a3` | 3.99:1 on the selected-row band (`surfaceActive`), under the 4.5:1 body floor. Now 4.57:1 there and 5.4-6.8:1 elsewhere. |
| `lineControl` (new) | n/a | `#786782` | `line` is a 1.5-1.9:1 divider. A control marked only by its edge needs 3:1 (WCAG 1.4.11). `border-input` in the docs now points here. |
| `milestone` family | hue 287 | hue 272 | 20° from the anime orchid, which read as one purple. Now 46° from it. |
| `typeAnime` | hue 307 | hue 318 | Moves away from milestone; still orchid, still 44° from the brand rose. |
| `typeMovie` | hue 84 | hue 92 | 22° from `warn`. Now 30°. |
| `typeSeries` | hue 187 | hue 194 | 24° from `ok`. Now 31°. |

Lightness and chroma are unchanged on every hue nudge, so contrast on `bg` and `surface` stays 5.3-12:1. `accent`, `ok`, `warn`, `danger`, `bg` and `surface` are pinned by `apps/docs/test/token-drift.test.ts` and did not move; `danger` stays 22° from the accent, which is acceptable because they never share a row (error vs selection).

Docs UI follows the same rules: primary buttons carry dark ink on rose (white measured 3.6:1, and 2.1:1 on hover); a selected tab is accent text on the accent fill, not a second filled gradient competing with the one primary action.

### ANSI-256 fallbacks (low-color terminals)

bg `#121212` · surface `#1c1c1c` · elevated `#262626` · active `#303030` · accent `#ff87af` · accentDeep `#d75f87` · ok `#5fd7af` · warn `#ffaf5f` · danger `#ff5f5f` · info `#5fafff` · milestone `#5f87ff` · anime `#d787ff` · series `#5fd7d7` · movie `#ffd75f` · lineControl `#767676`.

### 16-colour terminals

Six hues plus their bright twins. Every signal that carries meaning gets its own entry, because collapsing them makes one colour mean several things (the accent, anime, milestone and the mixed-day blend were all literal `magenta`, and `warn` and the movie kind were both `yellow`): accent `magenta` · anime `magentaBright` · milestone `blueBright` · info `blue` · ok `green` · warn `yellow` · movie `yellowBright` · danger `red` · series `cyan` · mixed `gray`. `apps/cli/test/unit/app-shell/color-resolution.test.ts` fails if two of them collapse again.

### Hierarchy rule

Color is **earned**. Neutrals carry structure; **one** rose accent marks where you are; semantics mark state; kind-colors tag content. Never two accents competing in one row. A screen that's mostly neutral with a few decisive color hits is the target — that restraint is the premium feel.

**Adoption:** edit `packages/design/src/tokens.ts` + `color-resolution.ts`, regenerate terminal snapshot captures. This is its own implementation slice (it touches the whole CLI) — see the open decision in the initiative roadmap. The one identity call: **anime moves from rose to orchid** so it stops colliding with the brand accent (brand stays rose; the fox stays rose).

## 5. Voice

Short, precise, a little dry. "Finds the playable stream." "Nothing fabricated." "Airs today." Never marketing fluff, never fake hype. Lowercase command-line cadence in-app; Title Case for surface headers.

## 6. Asset index

- `kunai-mark.svg` — logo mark (fox + blade)
- `kanna-bust.svg` — the traced vector source; every static surface renders from it
- `ip-as-logo-batch/` — raster masters (A/B/C)
- `apps/docs/components/brand/kunai-fox.tsx` — live SVG character
- `trace-kanna.sh` — regenerates `kanna-bust.svg` from the raster master
- `generate-social-cards.mjs` — docs OG + GitHub social SVG/PNG exports
- `kunai-social-docs.svg` / `kunai-social-docs.png` — docs Open Graph master (1200×630)
- `kunai-social-github.svg` — GitHub social master (1280×640)
- `kunai-mascot-og.png` — mascot raster for dynamic OG renders
- `palette-board.mjs` → `palette-current.svg` / `palette-proposed.svg` — token comparison board
- `kunai-brand-system.md` — this file
- `image-prompts.md` — optional raster prompts (hero/GIF); social cards are generated in-repo
- `.github/social-preview.png` — preferred GitHub repo Settings → Social preview export (under 1 MB); if the generator falls back to JPEG, it removes the oversized PNG and writes `.github/social-preview.jpg` instead — upload whichever path is printed as `GitHub upload:` when you run `generate-social-cards.mjs`
