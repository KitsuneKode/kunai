# Kanna pose sheet — batch 2

One consistent character, not three directions. Locked to Operator A2.
Spike: `spike/kunai-mascot-ip`. Also copied into `kanna-polish` (`feat/kanna-presence`) for the presence work.

## Model

- **Provider:** Cursor `GenerateImage`
- **Model:** not disclosed — same substitute as batch 1
- **Constraint delivery:** `main-prompt constraints`
- **Reference:** the model sheet itself (`kanna-model-sheet-v1.png`) for the pair draws; the A2 master it was seeded from has since been retired with the rest of batch 1
- **Canvas:** sheet `1536 × 1024`; pair sheets `1536 × 1024`

## Palette (locked)

| role                              | hex       |
| --------------------------------- | --------- |
| fur                               | `#ff8fb0` |
| cream — muzzle, inner ears, chest | `#ffc6d8` |
| background and eyes               | `#1c1620` |

## Step 1 — model sheet

`kanna-model-sheet-v1.png`. One pass. Cell 3 is the same animal as cell 1 (round head, blunt triangular ears, cream muzzle + blaze, baby proportions). Cells were not mixed across runs.

| cell | pose                           | file                              | runtime map  |
| ---- | ------------------------------ | --------------------------------- | ------------ |
| 1    | front sit, ears up             | `kanna-sheet-1-front-sit.png`     | `idle`       |
| 2    | three-quarter sit, facing left | `kanna-sheet-2-three-quarter.png` | construction |
| 3    | side profile, standing         | `kanna-sheet-3-side-profile.png`  | construction |
| 4    | curled asleep, one ear tipped  | `kanna-sheet-4-nap.png`           | `nap`        |
| 5    | ears flat, one eye squinted    | `kanna-sheet-5-oops.png`          | `oops`       |
| 6    | head and shoulders             | `kanna-sheet-6-bust.png`          | `bust` / nav |

## Step 2 — remaining poses (pairs)

| pair         | file                         | split files                                   | runtime map     |
| ------------ | ---------------------------- | --------------------------------------------- | --------------- |
| seek + carry | `kanna-poses-seek-carry.png` | `kanna-pose-seek.png`, `kanna-pose-carry.png` | `seek`, `carry` |
| watch + peek | `kanna-poses-watch-peek.png` | `kanna-pose-watch.png`, `kanna-pose-peek.png` | `watch`, `peek` |

Seek is the weak cell: a raised paw, not a low lean with ears swept back. Do not mix it with a later redraw of carry — redraw the pair together.

## Wiring

Every pose is traced: `POSES` in `../kanna-rig.mjs` names the master each one
comes from, `trace-kanna.mjs` writes them all into `../kanna.svg`, and
`export-fox-assets.ts` rasterizes from that. Nothing reads a master directly
any more.

`seek` and `peek` were the two held back. Both now ship, re-posed from their own
traced pieces rather than regenerated — see "What was redrawn" in
[../kanna-art-brief.md](../kanna-art-brief.md). If the sheet is ever
regenerated, redraw `seek` and `carry` together as this file already says.
