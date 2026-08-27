# Kunai IP-as-logo batch 1

Raster masters for the illustrated kitsune. Overlay from the Kunai brief: fox/kitsune subject, Ember Dusk palette, no props, blunt triangular ears as the one species-defining feature.

Live character: `apps/docs/components/brand/kunai-fox.tsx`. Export: `bun apps/docs/scripts/export-fox-assets.ts`.

## Model

- **Provider:** Cursor `GenerateImage`
- **Model:** not disclosed by the runtime — **not confirmed** as GPT Image 2 / Seedance 5.0 Pro / Nano Banana Pro
- **Constraint delivery:** `main-prompt constraints`
- **Canvas:** native `1024 × 1024` (requested 1:1; skill asks ~1536²)
- **Quality note:** this is a substitute generator. A second draw on a recommended model is fair if a candidate is close but not there.

## Palette (locked)

| role | hex | use |
| --- | --- | --- |
| IP 1 · fur | `#ff8fb0` | body |
| IP 2 · cream | `#ffc6d8` | muzzle, inner ears, chest |
| background | `#1c1620` | tile; reused for eyes |

## Directions

- **A — Operator.** Still, square, unbothered. Sells “gets out of the way.”
- **B — Courier.** Mid-motion, chest forward, ears swept back. Sells “finds the playable stream.”
- **C — Night Watcher.** One ear tipped, cream blaze, knowing gaze. Sells kitsune mischief.

## Candidates

| label | direction | corner | file | size |
| --- | --- | --- | --- | --- |
| A1 | Operator | lower-left | `kunai-ip-A1-operator-ll.png` | 1024² |
| A2 | Operator | lower-right | `kunai-ip-A2-operator-lr.png` | 1024² |
| B1 | Courier | lower-left | `kunai-ip-B1-courier-ll.png` | 1024² |
| B2 | Courier | lower-right | `kunai-ip-B2-courier-lr.png` | 1024² |
| C1 | Night Watcher | lower-left | `kunai-ip-C1-watcher-ll.png` | 1024² |
| C2 | Night Watcher | lower-right | `kunai-ip-C2-watcher-lr.png` | 1024² |

One pass. No retries, no ranking, no post-processing of the six masters. `preview-board.png` is a labeled contact sheet plus a 16px nearest-neighbor row for judging, not a generated asset.

## Shared prompt skeleton

Fill-ins per candidate: corner (`lower-left` / `lower-right`) and the personality clause below.

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid #1c1620. Keep #1c1620 visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing rose kitsune fox IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature: a pair of triangular ears with blunt rounded tips.
Complexity: use only 4-7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: warm rose #ff8fb0 for the fur body, cream #ffc6d8 for the muzzle, inner ears and chest, plus the background #1c1620. Organize both IP colors into broad purposeful masses and reuse them for facial marks. Eyes are simple solid ovals in #1c1620. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the assigned <corner>, filling about 85-95% of the square so it remains visually dominant. Cropping at the bottom or assigned side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation. Add no weapons, blades, or props.
```

Personality clauses:

- **A:** sitting square, still and composed, facing forward, gaze level and unbothered, ears up and symmetrical.
- **B:** alert and caught mid-motion, chest pushed forward, head slightly raised, both ears swept back as if by wind. Eyes wide and focused.
- **C:** calm, knowing, slightly mischievous, one ear tipped while the other stays upright, cream chest blaze prominent. Eyes slightly narrowed.

## What this batch is for

Pick a winner (or ask for another draw of one direction). Landing it still means replacing `.reference/design/brand/kunai-mascot-og.png` (keep under ~40 KB, 8-colour indexed PNG) and rebaking `apps/docs/lib/generated-mascot.json`. The mark stays. Nothing in this batch is wired into the product yet.
