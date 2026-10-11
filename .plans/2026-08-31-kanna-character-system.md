# Kanna Character System

Status: steps 1-6 landed in #285; residue below
Owner: brand
Created: 2026-08-31
Target: 0.3.0

Kunai ships two mascots. The runtime surfaces draw Kanna; the README, both
social cards and the Discord icon draw a pixel fox from a second generator that
the Kanna work never touched. This plan closes that, gives every pose a
consumer, and replaces the raster pipeline with one layered SVG.

## What is wrong today

Three separate problems, one root each.

**Two sources of truth.** `.reference/design/brand/generate-mascot.mjs` calls
itself "the SOURCE OF TRUTH for the Kunai mascot" and emits an ASCII pixel grid.
It writes `kunai-mascot.svg`, `kunai-mascot-animated.svg` and
`kunai-readme-hero.svg`; `generate-social-cards.mjs` then reads
`kunai-mascot.svg` and writes both social cards plus `.github/social-preview.png`.
`apps/cli/assets/discord/README.md` states its icon comes from the same pixel
art. Six surfaces, all pre-Kanna, all downstream of one generator.

**Three pets ship and are never drawn.** `companion-assets.ts` imports six poses
with `with { type: "file" }`, which embeds each in the compiled binary. Only
`idle`, `wait` and `nap` have call sites — `go`, `watch` and `oops` have none.
That is ~33 KB of unreachable art in every published binary, and it is the
`declaration → reader` seam this repo names first.

**The blank face has all the traffic.** Kanna's expression range is `plain`,
`half-lid` (on `watch`) and `angled brow` (on `oops`). The two with real
expression sit on the docs hub and the 404. The plain one is the hero at 120px,
the nav mark at 28px, and the roamer at rest.

## Decisions

Settled with the developer on 2026-08-31.

| Decision        | Choice                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| CLI presence    | **The hunt** — she appears during the wait and during failure, never during success or reading |
| Source of truth | **One layered SVG**, rasterized at build time for the surfaces that need pixels                |
| Rendering style | Flat construction with shading as a **vector layer**, not baked into pixels                    |
| Batch 1 art     | **Restored as expression reference**, never as a shipping source                               |
| README hero     | **Terminal frame with the real command**, Kanna at the edge, not a portrait lockup             |
| CLI header      | Drawn PNG where a graphics protocol exists, **nothing** where it does not                      |
| Release         | All of it in **0.3.0**                                                                         |

## The character

### Model sheet and expression sheet are different documents

Batch 1 varied _construction_ between poses — ear silhouette, eye treatment, a
chest blaze that appeared and vanished — which is why it read as three animals.
Kanna v1 fixed construction and then varied nothing, so every pose wears the
same face. Neither is the goal.

Construction is fixed: one head ratio, one ear silhouette, one cream muzzle, one
chest blaze, three flat colours. Expression is a layer over it:

| Name       | Shape                        | Reads as                                               |
| ---------- | ---------------------------- | ------------------------------------------------------ |
| `squint`   | narrow, slanted down and out | unimpressed — **the batch-1 shape, currently missing** |
| `plain`    | round, open                  | neutral                                                |
| `half-lid` | flat top edge                | calm, watching — _exists on `watch`_                   |
| `brow`     | angled bars over round eyes  | annoyed — _exists on `oops`_                           |
| `wide`     | enlarged with a highlight    | alert, surprised                                       |
| `closed`   | upward arc                   | asleep, content                                        |
| `blink`    | thin bar                     | transient, animation only                              |

Only `squint` is genuinely new. The rest is reassignment.

### Batch 1 is reference, not history

`093a720d` deleted the six batch-1 masters, reasoning that "leaving 5.3 MB of
superseded art beside the set that replaced it is how the next person picks the
wrong one." That held while they were superseded. They are now the reference for
the `squint` shape, so they come back to
`.reference/design/brand/expression-reference/` with a README stating they exist
for the eye and brow vocabulary only and are never a shipping source. Available
for the redraw, impossible to mistake for the live set.

## Source of truth

### One SVG, layered on the head

The trace runs `vtracer` over the approved master — the art is flat colour
regions, which is what vtracer is built for; potrace only handles bitonal input.
Output is cleaned up and grouped.

Layering is deep only on the head, because expression lives in the face and the
head is what gets reused most — nav, favicon, Discord icon and both social cards
are all bust crops. Full-body poses stay single silhouette paths.

```
kanna.svg
├─ <defs>          gradients — the shading layer, toggleable per surface
├─ <g id="body">   pose path
├─ <g id="tail">   sway
└─ <g id="head">
   ├─ ears         flick
   ├─ muzzle
   ├─ eyes         blink, pupil tracking
   └─ brows        expression swap
```

### What renders from what

| Renders directly from the SVG | Rasterized at build                                    |
| ----------------------------- | ------------------------------------------------------ |
| Nav mark 28px                 | CLI pets 128px PNG — graphics protocols need pixels    |
| Favicon, `apple-icon`         | Docs stills 320px WebP — cheaper than SVG at that size |
| README hero                   | Discord presence icon 1024px PNG                       |
| Both social cards             | `generated-mascot.json` for the OG route               |
| Docs hero and roamer          |                                                        |

Rasterization reuses the existing flood-fill and one-pixel erode in
`export-fox-assets.ts`. The masters are still opaque plates and the eyes still
reuse the background colour, so a global `-transparent` still blinds her — that
constraint does not change.

### Deleted

- `generate-mascot.mjs` and its three SVG outputs
- The second source of truth, entirely

`generate-social-cards.mjs` stays, repointed at the new SVG. `kunai-mark.svg`
stays untouched — it is a mark, not a character, and the brand system already
assigns favicons and badges to it.

## Pose contract

Every pose has a consumer, or it does not ship.

| Pose           | Expression                | CLI                                  | Docs                                      |
| -------------- | ------------------------- | ------------------------------------ | ----------------------------------------- |
| `idle`         | `squint` **(reassigned)** | Setup summary                        | Hero 120px, nav 28px, roamer settled      |
| `wait`         | `plain`                   | Setup frame                          | Page banner, sidebar 36px, home flow      |
| `seek`         | `wide`                    | **Provider race** (new)              | **Search in flight** (new)                |
| `go` / `carry` | `squint`                  | **mpv handoff beat** (new)           | Home flow, closing 112px, roamer walking  |
| `watch`        | `half-lid`                | **Pre- and post-playback** (new)     | Docs hub 96px, hero alert, roamer sitting |
| `oops`         | `brow`                    | **Error state, graphics tier** (new) | — (404 moves to `peek`)                   |
| `nap`          | `closed`                  | Goodbye screen                       | **Roamer asleep** (new)                   |
| `peek`         | `wide`                    | Footer rule — deferred, ambient tier | **404, section rules** (new)              |
| nav bust       | `squint`                  | —                                    | Nav, favicon, Discord, social cards       |

Both previously held-back poses get jobs. Both still need the redraw recorded on
the asset board: `seek` reads too close to `idle`, and `peek` was drawn on a
ledge in the same rose as her fur so the alpha cut ships her welded to a slab.
Giving them consumers is what makes those redraws worth doing.

## The hunt

She is not decoration during resolve — she is doing the thing that was asked
for. Three poses, one narrative, mapped onto work the program performs.

```
⠋  racing 7 providers…            [seek]   leaning in, ears back
✔  1080p · allanime · 2.5s        [carry]  dart in mouth, one beat
   handing to mpv

── playing ──────────────────
   Frieren · E12 · 24:31          [watch]  tail wrapped, half-lid

── error ────────────────────
·  Couldn't reach that source
   🦊 hit a wall on that one.     [oops]
```

This keeps the line already committed to in `kanna-voice.ts`: the CLI is her at
work, and a chatty line in someone's shell is a bug. She appears during the wait
and during failure; she is silent during success and while the user is reading.

Everything sits behind the existing three-tier `companionMode` policy. No new
escape hatch — `KUNAI_PET=off`, `glyph`, and non-TTY output already do the right
thing.

**Unproven:** `watch` during playback is the only pose that persists rather than
flashing past, and mpv usually takes over the terminal. In practice it likely
renders on the pre-handoff and post-play surfaces, not underneath running video.
Confirm against the real playback flow before building it.

## Roamer

The current model is a mirror: position is a function of the pointer, which is
why it reads as software rather than as an animal. The replacement gives her
attention — she has to notice, decide, travel and settle, and she can be wrong
about whether the movement was meant.

The reference is `oneko`, the X11 cat that chases the pointer and sleeps once it
catches up.

|             | Current                                 | Proposed                                        |
| ----------- | --------------------------------------- | ----------------------------------------------- |
| Retarget    | every pointer move                      | only past a 90px notice threshold               |
| Reaction    | instant                                 | 350ms beat before committing                    |
| Speed       | 620 px/s, eased to 28% in the dead zone | 300 px/s, eased in and out                      |
| Destination | the cursor                              | an offset ~70px beside it, on the approach side |
| At rest     | `idle`, then `wait`                     | `watch` → `idle` → `nap`                        |
| Wake        | any movement                            | only past the threshold                         |

Two refinements from the live demo:

**Mid-walk recalibration.** If the pointer moves past the threshold while she is
already walking, she re-targets — but pays a turn cost, a brief slow-down as
heading changes, rather than snapping to the new vector. Animals do not pivot
instantly, and the cost is what gives the movement weight.

**Three-stage rest, not two.** Arrive → `watch`, looking at you → after ~6s
`idle`, looking away → after ~20s `nap`, curled. The middle stage is what makes
her read as bored rather than switched off, and it is where an unprompted line
should fire.

Settling _beside_ the pointer rather than on it is the single most important
change. Anything that lands under the cursor reads as cursor decoration, not as
a companion.

Everything stays behind the existing guards: `prefers-reduced-motion`, pointer
type, and the stored dismissal, all checked in a mount effect so server output
contains nothing of her.

## First contact

### The README hero stops being a portrait

The current banner is a fox head beside a wordmark — a logo lockup, which is
what a mark is for, and Kunai already has one. Spending the hero on a character
portrait means the first thing a visitor sees says nothing about what the tool
does.

The replacement is the move the social cards already make: a terminal frame
containing the real command, with Kanna at the edge — `peek` over the top rule,
watching it run. She carries the personality; the terminal carries the pitch.

### Where else she earns her place

- **404** — hers already, but `peek` is the better joke than `oops`: looking over
  an edge for the thing that is not there, rather than looking guilty about it.
- **Docs section rules** — what `peek` was drawn for. One per long page.
- **Discord presence icon** — currently pixel art, and the widest-reach surface,
  since it appears in other people's servers while a user watches.
- **Empty and error states** — already hers as text on every terminal. Unchanged;
  that is the tier that matters most.

### Where she stays out

Provider tables, flag references, the analytics dashboard, and error output a
person is going to paste into an issue. A character on a reference table is
noise, and a character beside a stack trace makes a serious moment look
unserious.

## The CLI header

`APP_LABEL` is `🦊 Kunai` in `shell-theme.ts` and appears in seven shells, which
makes it the highest-traffic Kanna slot in the product. It becomes a drawn PNG
where a graphics protocol exists and **nothing** where one does not — the header
already says "Kunai" in text, so the mark is decorative and dropping it cleanly
beats a lone emoji.

**Spike first.** The header is persistent chrome that re-renders on every
keystroke, and Ink erases the whole frame each render, which is why
`repaintAfterInkRender` has to stay true. A graphics placement there repaints
constantly. Prove it does not flicker on a real Kitty session before building
it; if it does, the header stays text and this decision is revisited.

## Risks and unknowns

| Risk                                                      | Handling                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Header placement flickers in persistent chrome            | Spike on real Kitty before any other header work                                                  |
| Trace quality is not good enough to ship                  | Show the traced result before anything depends on it; fall back to regenerating painterly rasters |
| `watch` has no real playback surface                      | Confirm against the playback flow; drop the pose from the CLI lane if not                         |
| Vector shading looks worse than painterly raster at 320px | Compare both at real size before committing the style                                             |
| Graphics tier still unverified on real terminals          | Blocks release regardless — it is the open checklist item on #285                                 |

## Testing

- Pose union drives the asset guards, so a pose cannot be added without an alpha
  and size check — already true in `kunai-fox.test.ts`, extend to the CLI lane.
- Every pose in `CompanionPose` must have at least one call site. Assert it, so
  the dead-weight regression cannot come back.
- Roamer state machine unit-tested against an injected clock — no timeouts, no
  real sleeps.
- Expression assignment asserted per surface, so `idle` cannot silently revert to
  the blank face.
- Rasterization output compared against committed budgets, as now.

## Sequencing

Ordered so nothing waits on the trace. Everything below landed in #285 except
where noted.

1. **Expression reassignment** — done. `idle` and the nav bust render from the
   vector with `squint`; the other poses already carried their intended face.
2. **Pose wiring** — done, as `CompanionHost` rather than per-surface pets. Every
   embedded pose is reachable and every moment has a reporter, both asserted.
   `peek` on the 404 is **not** done: it is one of the two held-back poses.
3. **Roamer rework** — done. Notice, commit, turn cost, three-stage rest, in a
   pure clock-injected machine.
4. **Header spike** — done, and the answer was no. `sixel-overlay.ts` already
   records that a once-per-second timer made a poster blink on ConPTY; the header
   re-renders on every keystroke. `APP_LABEL` stays text.
5. **The trace** — done for the bust and `idle`. Full-body poses for the other
   four are still raster, snapped to the brand palette on export.
6. **`generate-mascot.mjs` deleted** — done. One source of truth.

## What is actually left

- **`seek` and `peek` redraws.** Until then `seeking` draws `go`, which is one
  line in `companion-moment.ts`, and the 404 keeps `oops`.
- **Trace the four remaining full-body poses**, so every still comes from vector
  rather than a palette-snapped raster.
- **Graphics tier on a real terminal** for the surfaces beyond setup.
