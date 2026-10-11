# Kunai fox

Illustrated kitsune stills for docs, banners, OG, and the CLI companion. These are the A/B/C masters, not a traced stand-in.

| pose    | batch still | meaning                    |
| ------- | ----------- | -------------------------- |
| `wait`  | Operator A  | empty, waiting, sidebar    |
| `go`    | Courier B   | search, loading, install   |
| `watch` | Watcher C1  | 404, docs hub, mischief    |
| `idle`  | Watcher C2  | home, OG, nav, default pet |

Site stills: `apps/docs/public/brand/fox/`. Banners: `kunai-fox-banner.tsx`. Raster masters: `.reference/design/brand/ip-as-logo-batch/`. Export with `bun .reference/design/brand/export-fox-assets.ts` then rebake `generated-mascot.json`.

The blade mark (`kunai-mark.tsx`) stays on favicons and badges, and the nav loads the dedicated
128px `nav.webp` rather than a pose still — the sheet draws that view as a head-and-shoulders bust
for this job, because cropping a standing pose down to 28px puts her eyes on the bottom edge. CLI
chrome stays `🦊 Kunai`. `KUNAI_PET=off` retires the companion; `KUNAI_PET=glyph` pins it to the
unicode glyph.

Stills are cut to alpha and quantized by the export script. They must never be shipped as the opaque
masters: those carry a solid `#1c1620` plate that shows as a lighter box on the hero and a dark box
over a light terminal background.

## Walking

A still can bob but it cannot swing a leg, so whenever she is travelling she is drawn as vector parts
instead (`kunai-fox-walker.tsx`): the same palette and proportions as the `go` still, rebuilt with a hip
and a knee on each leg, a tail that sways from its root, and ears that trail the head. Resting poses
(sitting, napping) stay raster; the roamer cross-fades between the two over 140ms so the hand-off does
not show as a change of art style.

| file                                    | owns                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `lib/fox-gait.ts`                       | pure: stride phase to joint angles, the standing pose, blending between poses |
| `components/brand/kunai-fox-walker.tsx` | the drawing, and the rig that hangs a pose on it every frame                  |
| `lib/patrol-machine.ts`                 | pure: where she goes when nothing is steering her (the footer)                |
| `lib/roamer-machine.ts`                 | pure: where she goes when she is following the pointer                        |

- The stride advances by **distance travelled** (`advancePhase`), never by a timer, so her feet keep pace
  with her speed and stop on the frame she does.
- The rig writes `transform` attributes directly; a pose is never React state, because it changes every
  animation frame.
- She walks in three places: following the pointer (`kunai-fox-roamer.tsx`, fine pointers only), along the
  home timeline as the section scrolls (`home-flow-timeline.tsx`), and pacing the footer
  (`kunai-fox-patrol.tsx`, only while the footer is on screen and the tab is visible).
- Under `prefers-reduced-motion` she never walks: the roamer is not rendered, the timeline fox stands at the
  last step, and the footer fox stands still.
- The drawing faces right. Facing left is `data-facing="left"` flipped in CSS, not a second drawing.
- She leans into her path. `withHeading` tilts the torso nose-up on a climb and nose-down on a descent
  (capped at 52 degrees), the head leads a little further, and on a steep climb the front paws reach and
  the hind legs drive. The heading is smoothed with a fixed time constant, so it feels the same at any
  frame rate. Facing stays horizontal: a vertical move keeps whichever way she was already facing, and
  the tilt sign is the same for both facings because the flip is applied outside the rig.
- If the pose stills are redrawn, redraw the walker's shapes against the new `go` still; the palette
  constants at the top of `kunai-fox-walker.tsx` are sampled from it.
