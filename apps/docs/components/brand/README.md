# Kunai fox

Illustrated kitsune for docs, banners, OG, and the CLI companion.

| pose    | batch still | meaning                    |
| ------- | ----------- | -------------------------- |
| `wait`  | Operator A  | empty, waiting, sidebar    |
| `go`    | Courier B   | search, loading, install   |
| `watch` | Watcher C1  | 404, docs hub, mischief    |
| `idle`  | Watcher C2  | home, OG, nav, default pet |

SVG: `kunai-fox.tsx`. Banners: `kunai-fox-banner.tsx`. Raster masters: `.reference/design/brand/ip-as-logo-batch/`. Export with `bun apps/docs/scripts/export-fox-assets.ts` then rebake `generated-mascot.json`.

The blade mark (`kunai-mark.tsx`) stays on favicons and badges. CLI chrome stays `🦊 Kunai`. Set `KUNAI_PET=0` to keep the companion on the unicode glyph.
