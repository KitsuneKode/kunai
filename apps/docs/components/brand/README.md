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
