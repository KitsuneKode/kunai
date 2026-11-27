---
status: active
created: "2026-11-27"
lastReviewed: "2026-11-27"
---

# Kanna — what is left

The character system and the personality plan both landed; they are in
`.archive/plans/` as history. This is the residue, and it is short on purpose.
How she works now is written down where it is true:
[docs/users/kanna.mdx](../docs/users/kanna.mdx) for the person using her,
`apps/cli/src/app-shell/companion-moment.ts` for which pose and which line
belong to which moment, and `.reference/design/brand/kanna-rig.mjs` for the
art.

## Decisions the running product revised

Two things the landed plans said turned out differently, and the code is what
is right:

- **`watch` is the wait before playback, not playback.** The pose contract gave
  `watch` to "playback running". Nothing drew it there — the now-playing body is
  a different branch from the bootstrap body — and it should not be drawn there:
  playback running is success, and someone is watching something else. It is
  the last beat of the hunt instead: the player has the stream and is coming up.
- **The terminal animates her; Ink does not.** The personality plan ruled out
  animating the picture because it assumed a re-upload per frame. Kitty and
  Ghostty play uploaded frames on their own clock, so she blinks with no render
  and no bytes after the first upload. The cell-based reactions shipped too, as
  the copy tier's motion.

## Remaining

### 1. Novelty decay

The full character on first run; something smaller on every run after. A
companion that is the same size on run 300 as on run 1 stops being charming and
starts being furniture. Nothing counts runs today. The bust is traced and
exported (`bust` in `kanna.svg`) but no terminal surface draws it — that is the
crop this wants.

### 2. The docs site has not caught up with the art

`seek.webp` and `peek.webp` are exported to `apps/docs/public/brand/fox/` and no
component loads them: `STILLS` in `apps/docs/components/brand/kunai-fox.tsx`
still lists six poses, the 404 still draws `oops`, and a resolve on the site
still borrows `go`. Wiring them is `STILLS`, `KUNAI_FOX_POSES`, and the 404.

Per-part motion on the site — ear flick, blink, pupils that track the pointer —
was blocked on addressable parts. It is no longer: every pose in `kanna.svg`
carries `.eyes` as its own layer, and `EARS` in `kanna-rig.mjs` holds the cut
for one ear per pose. The site still renders flat WebP stills.

### 3. Terminals nobody has looked at

The sprite path was watched on kitty 0.51 and Ghostty 1.4, and on tmux 3.8
passing through to kitty. The still path — iTerm2, WezTerm, and Sixel terminals
— goes through the same measured overlay every poster uses, but nobody has
looked at her on those terminals. Windows Terminal is the one most likely to
disagree.

Two moments have not been seen in a running session either, on any terminal:
`go` and `watch`. They are keyed to the `preparing-player` and
`starting-playback` stages, and with fixture providers — and with a real mpv
opening a local clip — the bootstrap passes through both in under a frame. The
mapping is unit-tested and both sprites render in the gallery; whether the
beats are long enough to read against a real provider is not known. If they
never are, the fix is to hold the carry for a minimum beat, not to draw her
during playback.

`oops` on a failed resolve is in the same position: the recovery view it sits
on was not reached with the fixtures (a failed handoff opens the source picker
instead).

### 4. Art that is still a re-pose rather than a drawing

`seek` is built from the traced pieces of its own master — pitched forward, ears
cut and laid back — and reads as a different pose from `idle` at companion
size, which was the bar. It is not a pose an illustrator drew. If the sheet is
ever regenerated, `seek` and `carry` should be redrawn as a pair, as
`kanna-pose-sheet.md` already says.

`go` carries a hand-authored dart: the flood fill that cuts the master's
background eats the plate-coloured original.

## Guardrails that still hold

- `KUNAI_PET=off` silences **everything**, copy included.
- Nothing decorative in non-TTY output.
- Every motion gated on `reducedMotionEnabled()`; under it the terminal is sent
  one drawing and no frames.
- No sound in the CLI, ever.
- A healthy session — launch, search, resolve, play, quit — hears at most four
  lines. If it hears more, the fix is deletion.
