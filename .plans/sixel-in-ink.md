# Sixel inside the Ink shell

Status: **not implemented**. The encoder exists and is tested; placement does not.

## Where things stand

| Piece                                          | State                                                |
| ---------------------------------------------- | ---------------------------------------------------- |
| Sixel encoder (`apps/cli/src/image/sixel.ts`)  | Done — median cut, transparency, RLE bands, 14 tests |
| One-shot renderer (`image/renderers/sixel.ts`) | Done — owns the cursor, writes directly              |
| Capability detection picks `sixel`             | Done — on any DA1 sixel reply, no chafa needed       |
| **Placement inside the Ink tree**              | **Missing — this is the whole remaining problem**    |

`resolveAppShellPosterCapability` in `apps/cli/src/app-shell/poster-renderer.ts`
downgrades `sixel` to a text renderer for the shell. Until placement exists that
downgrade is load-bearing: without it, sixel bytes land in a frame Ink is also
painting, and the result is corrupted text (see "Known symptom" below).

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

## What to build

1. **A placement module** owning: the shown cell `Rect`, `show`, `hide`, and
   `erase(region)`. One image at a time, matching yazi.
2. **`moveLock(x, y, write)`** with the ConPTY branch above. Everything that
   writes graphics goes through it — including the Kitty path, which currently
   writes to `process.stdout` directly.
3. **Absolute position for the poster region.** The hard part: Ink does not
   expose where a component landed on screen. Options, cheapest first:
   - Render the poster pane as a fixed-size box at a layout position we compute
     ourselves, rather than asking Ink where it ended up.
   - Query the cursor with CSI 6n immediately after Ink commits the frame.
   - Patch into Ink's output pipeline to learn the frame origin.
4. **Collision handling.** Ink repaints the whole frame on every commit, so the
   naive reading is "collide every frame". Either erase-and-repaint after each
   commit (yazi repaints on redraw too), or reserve the region so Ink never
   emits cells there.
5. **Only then** remove the downgrade in `resolveAppShellPosterCapability`.

## Cross-platform warning

`detectImageCapability` now selects `sixel` on any DA1 sixel reply, with no chafa
requirement. That changes Linux and macOS behaviour too — foot, WezTerm, and
`xterm -ti vt340` all answer that query. If the corruption above is caused by
sixel escaping into the frame, it will bite there as well, not only on Windows.
Consider reverting the detection half until placement lands; the encoder and its
tests stand on their own.

## References

- yazi sixel driver: `yazi-adapter/src/drivers/sixel.rs`
- yazi placement: `yazi-emulator/src/emulator.rs` (`move_lock`)
- yazi collision: `yazi-adapter/src/adapter.rs`
- Sixel format: <https://www.vt100.net/docs/vt3xx-gp/chapter14.html>
- Windows Terminal sixel support landed in 1.22; it does **not** implement the
  Kitty graphics protocol (microsoft/terminal#8389), so sixel is the only
  true-pixel path there.
