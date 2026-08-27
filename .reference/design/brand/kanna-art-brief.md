# Kanna — art brief

The brief for the one open item in the mascot work: replacing three separate
character _directions_ with one consistent character in a full pose sheet.

Everything mechanical is already solved — the export cuts alpha, quantizes, and
sizes for both the site and the terminal. This document is only about the
drawing. When new masters land, drop them in `ip-as-logo-batch/`, point the two
maps named at the bottom at them, and re-run the export.

---

## The problem being solved

The current set is A (Operator), B (Courier) and C (Watcher) — three directions
from one generation pass, drawn so a human could pick one. All three shipped.
The result reads as three different foxes:

|             | A · Operator        | B · Courier     | C · Watcher       |
| ----------- | ------------------- | --------------- | ----------------- |
| eyes        | large soft ovals    | one narrow slit | angular, scowling |
| ears        | two, upright, split | fused and swept | one folded        |
| chest blaze | present             | absent          | large             |
| mouth       | drawn               | none            | drawn             |

A mascot survives on one thing: someone recognising the same creature twice.
Three eye treatments across four poses never gives them the chance.

## The locked character

**Kanna is direction A, the Operator.** She is the roundest, the only one with
both ears intact and symmetrical, she keeps the cream chest blaze, and she is
the only one that stays legible at 28px — which the nav needs and the test
`apps/docs/test/kunai-fox.test.ts` enforces.

Use `kunai-ip-A2-operator-lr.png` as the visual reference for every generation
below. Do not restyle her. The construction is now fixed:

- one soft rounded continuous silhouette, no outline
- two triangular ears with **blunt rounded tips**, symmetrical, both always visible
- large head, small compact body, baby proportions
- eyes are simple solid ovals in `#1c1620` — only their _openness_ ever changes
- cream muzzle, inner ears, and chest blaze, always present
- exactly three flat colours, no gradients

| role                              | hex       |
| --------------------------------- | --------- |
| fur                               | `#ff8fb0` |
| cream — muzzle, inner ears, chest | `#ffc6d8` |
| background and eyes               | `#1c1620` |

### Who she is

A kanna (鉋) is a Japanese hand plane: you run it over rough wood and the
roughness leaves in one curl. Kunai is the blade; Kanna is who holds it. She
works nights, finds the stream, hands it to mpv, and gets out of the frame.

That matters to the drawing, not just the README. **She is never excited.** No
open-mouthed grins, no sparkles, no waving. Her range runs from calm to focused
to mildly put-out. A mascot that mugs for attention contradicts a tool whose
entire pitch is getting out of the way.

## Non-negotiables

Break any of these and the export produces a broken asset, not a different look.

1. **Flat colour only.** No gradient, no soft shading, no ambient occlusion, no
   glow, no drop shadow, no bevel. The previous batch ignored this and came back
   with 2,600–4,100 colours for art specified as three.
2. **Solid uniform `#1c1620` background**, edge to edge. The export flood-fills
   it to alpha; a shaded background makes that cut ragged.
3. **Never crop the character.** Even padding on all sides, nothing touching an
   edge. Half the current masters are cropped through an ear, which is why the
   nav needs a separate still.
4. **Both ears fully visible** in every pose.
5. **No props** except the one dart named in `carry`. No weapons, scenery, text,
   watermark, borders, or frames.

## The pose sheet

Seven poses. Each maps to a real runtime state, so the art can never drift into
decoration.

| pose    | reads as                                                | fires on                        |
| ------- | ------------------------------------------------------- | ------------------------------- |
| `idle`  | sitting, tail curled, ears up, eyes soft                | default / at rest               |
| `seek`  | leaning forward, ears back, one paw raised              | search + provider resolve       |
| `carry` | trotting, slim dart held crosswise in the mouth         | stream resolved → mpv handoff   |
| `watch` | sitting, tail wrapped over front paws, eyes half-lidded | playback running                |
| `nap`   | curled, eyes closed, one ear tipped                     | exit / idle timeout             |
| `oops`  | ears flat back, one eye squinted                        | provider dead / no stream / 404 |
| `peek`  | head and paws over an edge, body hidden                 | sidebar, nav, section rules     |

Each needs a `full` crop. `peek` and `idle` also need a `bust` (head and
shoulders) for slots under 40px.

---

## How to run this

You are using Grok through Cursor. Two things are worth knowing before you
start, because they shape the whole approach:

**No diffusion model holds a character across separate generations.** Ask for
seven poses in seven prompts and you will get seven cousins — which is exactly
how the current set happened. So:

**Generate the model sheet as ONE image first.** Six views in a single
generation forces the model to keep one character, because it is drawing them
into the same canvas in a single pass. That sheet becomes the reference for
everything after.

If the runtime offers image-to-image or a reference-image input, attach the
approved sheet to every follow-up generation. If it only takes text, generate
the extra poses in **pairs inside one image** rather than one at a time — two
poses per canvas still shares the pass, and shares the character.

### Step 1 — the model sheet

Run this first. Judge nothing else until it passes.

```text
Create one complete image: a character model sheet showing SIX views of a single mascot character, arranged as a clean 3x2 grid on one shared solid background.

Character: an extremely simplified, cute rose kitsune fox, built from one soft rounded continuous silhouette. One defining feature: a pair of triangular ears with blunt rounded tips. Large head, small compact body, baby proportions, thick rounded forms. A cream muzzle, cream inner ears, and a cream chest blaze.

The six cells, left to right, top row then bottom row:
1. front view, sitting square, ears up, eyes open and soft
2. three-quarter view facing left, sitting, ears up
3. pure side profile facing left, standing on all fours
4. front view, curled up asleep, eyes closed, one ear tipped
5. front view, ears flat back, one eye squinted, mildly put-out
6. head and shoulders only, close up, ears up, eyes open

Consistency is the single most important requirement. All six cells must be unmistakably the same individual: identical head-to-body ratio, identical ear silhouette, identical eye shape with only its openness changing between cells, and the cream chest blaze present in every cell that shows the chest. Do not restyle, redesign, or reinterpret the character between cells.

Colour: use exactly three flat colours in the entire image. Warm rose #ff8fb0 for the fur, cream #ffc6d8 for the muzzle, inner ears and chest blaze, and #1c1620 for both the background and the eyes. Every colour region must be one perfectly flat solid fill.

Use absolutely no gradients, no soft shading, no ambient occlusion, no glow, no lighting variation, no texture, no vignette, no drop shadow, no bevel, and no gloss. This is flat vector poster art.

Composition: centre each character within its own cell with generous even padding. Never crop any character at any edge. Keep both ears completely visible in every cell. Keep the background one uniform solid colour across the whole canvas.

Add no text, no labels, no watermark, no borders, no frames, and no drawn grid lines between cells. No weapons, props, scenery, or additional characters. No outlines around shapes.
```

**Accept it only if cell 3 is obviously the same animal as cell 1.** If it is
not, re-run. Do not proceed with a sheet you are unsure about, and never mix
cells from two different runs — that is precisely the mistake this brief exists
to undo.

### Step 2 — the remaining poses

With the approved sheet as reference, generate the poses the sheet does not
already give you. Keep them in pairs per image where you can.

```text
Create one complete image showing this exact character in a new pose, matching the attached reference exactly: same ear silhouette, same eye shape, same head-to-body ratio, same cream muzzle and chest blaze, same three flat colours (#ff8fb0 fur, #ffc6d8 cream, #1c1620 background and eyes).

New pose: <POSE>

  seek  - leaning forward, chest low, ears swept back, one front paw lifted mid-step, eyes wide and focused
  carry - trotting to the right in profile, head level, carrying one small slim dart crosswise in the mouth
  watch - sitting square, tail wrapped over the front paws, eyes half-lidded and calm
  peek  - only the head and two front paws visible over a straight horizontal edge, body hidden below it, ears up

Keep every colour region perfectly flat. No gradients, shading, glow, texture, or shadow of any kind. Centre the character with even padding on every side and never crop it at any edge. Keep both ears fully visible. Add no text, no background elements, and no props beyond the single dart named in `carry`.
```

## Tweak levers

When a result is close but wrong, change one thing at a time. In rough order of
how often you will need them:

| what you are seeing                     | what to change                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| soft shading or a gradient background   | add "completely flat single-colour fills, as if cut from paper" and repeat the no-gradient clause at the very end — last position carries weight |
| character cropped at an edge            | raise the padding language: "the character occupies the middle 70% of the frame with wide empty margins"                                         |
| ears different shape than the reference | describe them literally: "two triangular ears with blunt rounded tips, the same size and angle on both sides"                                    |
| looks like a different fox              | drop to two poses per image, or one — fewer cells means less drift                                                                               |
| too cutesy, sparkles, big grin          | add "calm and composed, mouth closed, no sparkles or decorative marks"                                                                           |
| too stern or aggressive                 | soften the eyes only: "eyes slightly larger and rounder, expression gentle and unbothered"                                                       |
| outline appearing around shapes         | "no outlines, no line art, no strokes — shapes are defined by colour alone"                                                                      |
| unreadable when you shrink it           | it has too much detail. "readable as a silhouette at 32x32 pixels"                                                                               |
| eyes lost against the background        | keep them `#1c1620` but add "eyes clearly separated from the background by the surrounding fur"                                                  |

## Acceptance checklist

Before a master is committed, check all seven poses together at thumbnail size:

- [ ] Every pose is recognisably the same individual
- [ ] Ear silhouette is identical across all seven
- [ ] Eye shape is identical; only openness varies
- [ ] Cream chest blaze present wherever the chest shows
- [ ] Nothing is cropped at any edge; both ears visible in all seven
- [ ] Background is one uniform solid `#1c1620`
- [ ] Still readable shrunk to 32×32
- [ ] Nothing in the set looks excited

## Landing it

1. Drop the new masters in `ip-as-logo-batch/` with the existing naming shape.
2. Point these two maps at them:
   - `STILLS` in `apps/docs/components/brand/kunai-fox.tsx`
   - `DOCS_STILLS_BY_NAME` and `CLI_PETS_BY_NAME` in `export-fox-assets.ts`
3. `bun .reference/design/brand/export-fox-assets.ts`
4. `bun apps/docs/scripts/sync-repo-content.ts` to rebake the OG data URL
5. `bun run test` — the size, alpha and facing guards in
   `apps/docs/test/kunai-fox.test.ts` will catch an un-quantized or un-cut export

The export handles the alpha cut and quantization; nothing needs doing by hand.
It flood-fills from a plate-coloured border rather than replacing `#1c1620`
globally, because the eyes are that same colour and a global replace punches
straight through them.

Once a consistent sheet exists, the next step is tracing her once to SVG. That
is what unlocks per-part motion on the site — an ear flick, a blink, pupils that
track the pointer — none of which a flat raster can carry. See
`apps/docs/components/brand/kunai-fox-live.tsx`, which does the two things a PNG
can do well rather than four things badly.
