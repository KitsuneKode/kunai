# Design — Render Runtime Hardening (Plan R)

Date: 2026-05-29
Status: approved (brainstorm), pending implementation plan
Roadmap: `docs/superpowers/plans/2026-05-29-premium-experience-roadmap.md`

Plan R of the premium-experience roadmap. Goal: a **flicker-free, resize-proof,
scrollback-clean** render runtime that every surface (Plan S) can safely sit on.
Renderer stays Ink (decision: do not migrate to OpenTUI now); isolate the runtime so
a future swap is contained. Code is source of truth.

## 1. Problem (verified)

- **No alternate-screen buffer.** Ink `render()` runs on the **main screen**
  (`ink-shell.tsx:268,1164`, `exitOnCtrlC:false`) with a full-height box
  (`:903 height={shellHeight}`). Consequences: quit leaves a full frame in the
  user's scrollback (pollution), and main-screen + full-height is prone to resize
  creep/flicker. No `\x1b[?1049h/l` exists anywhere.
- **Ghost images (triage A6).** Kitty image cells aren't reliably cleared; the only
  cleanup is `poster-renderer.ts:59` (`\x1b_Ga=d,d=A`). Stale posters linger on
  surface change / resize / exit.
- **Loader desync (A7), dancing lists (B8).** Animation cadence vs re-render, and
  non-reserved heights, cause visible jitter.
- Exit is otherwise handled: `main.ts:740-742` (SIGINT/TERM/HUP → shutdown),
  `:744/757` (uncaught/rejection), and `graceful-exit.ts` (`registerExitHandler`,
  `runExitHandlers`, `requestHardExit` with a 4s force timer). These give us the
  hooks to guarantee terminal restore.

## 2. Decisions (locked during brainstorm)

1. **Rich shell takes the alternate screen buffer**; restore is guaranteed on every
   teardown path. **Zen mode opts out** (inline, ani-cli-like).
2. **Stay on Ink**; isolate the render runtime behind a module so the renderer is
   swappable later.
3. Restore must be **idempotent** and run from: the graceful-exit handler, the signal
   shutdown path, `uncaughtException`/`unhandledRejection`, and a synchronous
   `process.on("exit")` last resort — so no matter how the process dies, the terminal
   is left clean (alt buffer left, cursor shown, images cleared).

## 3. Architecture

New module `apps/cli/src/app-shell/render-runtime/` owning all raw terminal control:

- `terminal-control.ts` — **pure** escape-sequence builders + an idempotent restorer
  factory (no IO; takes a `write` fn). Unit-tested.
- `terminal-runtime.ts` — thin integration: enters alt-screen on shell start, builds
  the restorer over `process.stdout.write`, and registers it on all teardown paths.
  Guarded by `process.stdout.isTTY` and a `zen`/opt-out flag.

The Ink `render()` call sites (`ink-shell.tsx`) call `enterRichRenderRuntime()` before
mount and rely on the registered restorer for teardown. Nothing else writes raw
screen-control escapes (poster/Kitty cleanup folds into the restorer's image clear).

### Sequences

- Enter: `\x1b[?1049h` (alt buffer).
- Restore (idempotent, one shot): `\x1b_Ga=d,d=A;\x1b\\` (clear Kitty images) +
  `\x1b[?1049l` (leave alt buffer) + `\x1b[?25h` (show cursor).

## 4. Pillars

### R-1 Alt-screen lifecycle (Phase R1)

Enter on rich-shell start; idempotent restorer wired into graceful-exit handler,
signal shutdown, uncaught handlers, and a sync `process.on("exit")` last resort.
Skip when not a TTY or in zen mode. Live-verify: normal quit, Ctrl-C, `kill`, and a
thrown error each leave the terminal clean with prior scrollback intact.

### R-2 Resize + reserved-height + ghost/loader (Phase R2)

- Confirm Ink incremental rendering is active (version check); ensure a single Ink
  instance; `patchConsole` so stray logs don't corrupt the frame.
- Resize: the debounced `useViewportPolicy` already exists; within the alt buffer,
  ensure a full clean repaint on settle with no residual artifacts.
- Reserved-height discipline for the "dancing" surfaces (B8): reserve scroll
  indicator / hint / group-header rows.
- Ghost images (A6): clear images on surface change + resize + teardown (the restorer
  owns teardown; a hook owns surface-change/resize).
- Loader cadence (A7): drive the dot-matrix animation off a single timer decoupled
  from re-render so frames don't desync.

## 5. Phasing

- **R1:** `terminal-control.ts` (pure, tested) + `terminal-runtime.ts` wiring +
  alt-screen enter/guaranteed-restore. Highest value, contained. Live-verified.
- **R2:** resize/reserved-height/flicker discipline + A6 ghost cleanup + A7 loader.

## 6. Testing

- Pure: restorer writes the exact restore sequence exactly once (idempotent); enter
  sequence correct; restorer over a fake writer never double-writes.
- Integration/live (R1): quit / Ctrl-C / SIGTERM / thrown error all restore the
  terminal (manual + a scripted spawn check capturing that `\x1b[?1049l` is emitted).
- R2: reserved-height snapshot stability; resize repaint has no artifacts (live).

## 7. Out of scope

- Surface redesign / parity → **Plan S**. Zen mode itself → **Plan Z** (R only
  exposes the opt-out flag). OpenTUI migration → not now (roadmap decision).

```

```
