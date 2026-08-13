# Sixel inside the Ink shell

Status: **implemented; requires Windows Terminal framebuffer smoke testing**.

## Where things stand

| Piece                                          | State                                                        |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Sixel encoder (`apps/cli/src/image/sixel.ts`)  | Done — median cut, transparency, RLE bands, 14 tests         |
| One-shot renderer (`image/renderers/sixel.ts`) | Done — owns the cursor, writes directly                      |
| Capability detection picks `sixel`             | Done — DA1 replies and WezTerm select the in-process encoder |
| Sixel overlay manager                          | Done — owns measured slots, redraw, and space erasure        |
| **Windows Terminal framebuffer smoke**         | **Required before release**                                  |

`SixelPosterPane` reserves a blank Ink rectangle and uses Ink's
`measureElement()` after layout to register its absolute cell rectangle. The
overlay manager paints sixel only after Ink has written its frame; sixel bytes
never enter Ink's text output.

## Known symptom this must fix

Posters rendered in the shell corrupt the list beside them: the _first_ ~28
columns of the rows spanned by the poster's height are overwritten, while rows
outside that band are intact. The damaged band's vertical extent matches the
poster's exactly.

That signature — left margin, poster's row range — is consistent with escape
sequences that return to column 0 (`$` in sixel, or a bare `MoveTo`) executing
inside a frame Ink believes it owns. Confirm before fixing:

```sh
KUNAI_IMAGE_PROTOCOL=half-block kunai   # in-process text only, cannot move the cursor
```

If the corruption disappears, the cause is an escape reaching stdout from a
poster path, and the fix is below. If it persists, the bug is in Ink layout and
this plan is the wrong thread to pull.

## How yazi does it

Read from a `--depth 1` clone of `sxyazi/yazi`; the interesting crates are
`yazi-adapter` and `yazi-emulator`.

### 1. Show = hide, remember, then place

`yazi-adapter/src/drivers/sixel.rs`:

```rust
ADAPTOR.image_hide()?;            // erase whatever was shown before
ADAPTOR.shown_store(area);        // remember the cell Rect we are about to occupy
Emulator::move_lock((area.x, area.y), |w| { w.write_all(&b)?; Ok(area) })
```

The adapter tracks exactly one shown region. Every show erases the previous one
first — the image layer, not the TUI, owns that rectangle.

### 2. `move_lock` — and the Windows-specific part

`yazi-emulator/src/emulator.rs`. This is the piece we do not have, and the
Windows branch is not incidental:

```rust
let mut w = TTY.lockout();                     // exclusive TTY lock

if TMUX.get() || cfg!(windows) {
    writef!(w, "{SaveCursorPos}{}{ShowCursor}", MoveTo(x, y))?;
    writef!(w, "{}{ShowCursor}", MoveTo(x, y))?;   // three times, deliberately
    writef!(w, "{}{ShowCursor}", MoveTo(x, y))?;
    thread::sleep(Duration::from_millis(1));
} else {
    write!(w, "{SaveCursorPos}{}", MoveTo(x, y))?;
}

let result = cb(&mut w);                       // the sixel is written here

if TMUX.get() || cfg!(windows) {
    write!(w, "{HideCursor}{RestoreCursorPos}")?;
} else {
    write!(w, "{RestoreCursorPos}")?;
}
w.flush()?;
```

Their comment: _"I really don't want to add this, but tmux and ConPTY sometimes
cause the cursor position to get out of sync."_ On Windows the `MoveTo` is
emitted **three times** with `ShowCursor` between and a 1 ms sleep after. That is
an empirical ConPTY workaround, and Windows Terminal is exactly the target we
care about — do not simplify it away without testing on ConPTY.

Note also the exclusive lock: no other writer may interleave between the move and
the image data.

### 3. Erase is painting spaces, not a protocol command

Sixel has no "delete image" — unlike Kitty's `a=d`. `image_erase` moves to each
row of the region and writes `width` spaces in the theme background, then resets
attributes, all inside another `move_lock`.

### 4. Collision detection is the missing concept

`yazi-adapter/src/adapter.rs`:

```rust
clear: |area| {
    let overlap = area.intersection(ADAPTOR.shown.get()?);
    if overlap.area() == 0 { return None; }
    ADAPTOR.driver.image_erase(overlap).ok();
    ADAPTOR.collision.set(true);
    Some(overlap)
}
```

Whenever the TUI clears a region, it intersects that region with the shown image
and, on overlap, erases the image and records a collision. **This is the
mechanism that prevents the corruption we are seeing.** Drawing the image and
hoping the TUI stays away is not a design; the TUI has to tell the image layer
when it paints over it.

## Implemented placement model

1. `apps/cli/src/app-shell/sixel-overlay.ts` owns every desired and shown
   rectangle. The Ink commit clears removed/moved panes before their effects run;
   erasing those rectangles afterward would overwrite the new UI. Same-slot
   replacement clear + paint remains one cursor-locked payload so ConPTY cannot
   expose a row-by-row erase or stale title pixels.
2. Its Windows path copies Yazi's move workaround: save cursor, issue the same
   absolute move three times with cursor-show escapes, wait 1 ms, write pixels,
   then hide and restore the cursor.
3. `apps/cli/src/app-shell/SixelPosterPane.tsx` uses Ink
   `measureElement()` in an effect to get the actual layout rectangle. Kunai's
   alternate screen means those coordinates are viewport coordinates; CSI 6n is
   unnecessary.
4. The pane is a fixed-size empty `Box`. Ink owns that blank rectangle on every
   frame and the overlay manager repaints pixels after it, which is the collision
   contract for the shell.
5. `launchSessionApp` schedules the post-frame overlay flush from Ink's
   `onRender` callback. Ink invokes that callback before writing, so the manager
   deliberately defers to the next task before painting.
6. Navigable preview surfaces unregister Sixel while selection is unsettled,
   and `usePosterPreview` keys a resolved overlay to URL plus geometry so a stale
   title cannot remount during the replacement fetch. The interactive encoder
   uses a bounded 64-colour palette to reduce main-thread and PTY pressure.
7. The high-frequency Now Playing rail keeps the measured Sixel output. The
   memoized poster pane marks its slot dirty only when it renders; unrelated
   one-second telemetry commits do not resend a large framebuffer payload, while
   navigation commits repaint an unchanged cached poster that Ink may have cleared.

## Cross-platform warning

Auto-detection selects sixel only when the terminal explicitly reports it (or
when WezTerm is identified). `KUNAI_IMAGE_PROTOCOL=half-block` remains the
stable comparison path; `KUNAI_IMAGE_PROTOCOL=sixel` forces a manual smoke.

## References

- yazi sixel driver: `yazi-adapter/src/drivers/sixel.rs`
- yazi placement: `yazi-emulator/src/emulator.rs` (`move_lock`)
- yazi collision: `yazi-adapter/src/adapter.rs`
- Sixel format: <https://www.vt100.net/docs/vt3xx-gp/chapter14.html>
- Windows Terminal sixel support landed in 1.22; it does **not** implement the
  Kitty graphics protocol (microsoft/terminal#8389), so sixel is the only
  true-pixel path there.
