import { debugImage } from "@/image/debug";

export type SixelRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type SixelOverlay = {
  readonly rect: SixelRect;
  readonly sixel: string;
};

const ESC = "\x1b";
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;
const SHOW_CURSOR = `${ESC}[?25h`;
const HIDE_CURSOR = `${ESC}[?25l`;
const RESET_ATTRIBUTES = `${ESC}[0m`;
const conPtySettleCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

const runtime = {
  isWindows: (): boolean => process.platform === "win32",
  write: (text: string): void => {
    process.stdout.write(text);
  },
  settleConPty: (): void => {
    // Yazi sleeps while holding its exclusive TTY lock. `Bun.sleep()` would
    // yield JavaScript here, letting Ink write a frame between cursor movement
    // and sixel bytes. Block for this one millisecond to preserve that lock.
    Atomics.wait(conPtySettleCell, 0, 0, 1);
  },
};

function sameRect(a: SixelRect, b: SixelRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sameOverlay(a: SixelOverlay | undefined, b: SixelOverlay): boolean {
  return a !== undefined && a.sixel === b.sixel && sameRect(a.rect, b.rect);
}

function moveTo(rect: Pick<SixelRect, "x" | "y">): string {
  // ANSI coordinates are 1-based; Ink's measured layout is 0-based.
  return `${ESC}[${rect.y + 1};${rect.x + 1}H`;
}

/**
 * Owns sixel overlays that live above Ink's text frame.
 *
 * Ink is responsible for reserving every registered rectangle with blank cells;
 * this manager paints changed pixels after an Ink commit. Removed and moved
 * panes are already cleared by that commit; erasing them again afterward would
 * overwrite the new Ink frame. Same-rectangle image replacement is the one
 * case that still needs an atomic clear before the new pixels.
 */
export class SixelOverlayManager {
  private readonly desired = new Map<string, SixelOverlay>();
  private readonly shown = new Map<string, SixelOverlay>();
  /** Slots whose owning Ink component committed and may have cleared pixels. */
  private readonly dirty = new Set<string>();
  private flushQueued = false;
  private flushing = false;
  private redrawRequested = false;

  register(id: string, overlay: SixelOverlay): void {
    const previous = this.desired.get(id);
    if (sameOverlay(previous, overlay)) return;
    this.desired.set(id, overlay);
    this.scheduleFlush();
  }

  /**
   * Register from the measured pane's post-commit effect. Even when its pixels
   * and rectangle are unchanged, that specific Ink render may have cleared the
   * reserved cells. Repaint the slot without clearing it first. Unrelated Ink
   * commits never call this method because the memoized pane does not rerender.
   */
  commit(id: string, overlay: SixelOverlay): void {
    this.desired.set(id, overlay);
    this.dirty.add(id);
    this.scheduleFlush();
  }

  unregister(id: string): void {
    if (!this.desired.delete(id)) return;
    this.dirty.delete(id);
    this.scheduleFlush();
  }

  /**
   * Called from Ink's onRender hook. Component registration already runs after
   * the commit and schedules a paint when pixels or geometry changed. Repainting
   * every unchanged overlay here made one-second playback telemetry blink the
   * poster continuously on ConPTY.
   */
  afterInkRender(): void {
    for (const [id, overlay] of this.desired) {
      if (!sameOverlay(this.shown.get(id), overlay)) {
        this.scheduleFlush();
        return;
      }
    }
    for (const id of this.shown.keys()) {
      if (!this.desired.has(id)) {
        this.scheduleFlush();
        return;
      }
    }
  }

  clear(): void {
    this.desired.clear();
    this.dirty.clear();
    this.scheduleFlush();
  }

  /** Drop state when Ink leaves the alternate screen; do not write to primary. */
  discard(): void {
    this.desired.clear();
    this.shown.clear();
    this.dirty.clear();
    this.redrawRequested = false;
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    setTimeout(() => {
      this.flushQueued = false;
      this.flush();
    }, 0);
  }

  private writeAt(rect: SixelRect, content: string): void {
    const move = moveTo(rect);
    if (runtime.isWindows()) {
      // ConPTY can lose one of these moves. This is Yazi's deliberately
      // redundant Windows workaround, including its tiny settling delay.
      runtime.write(
        `${SAVE_CURSOR}${move}${SHOW_CURSOR}${move}${SHOW_CURSOR}${move}${SHOW_CURSOR}`,
      );
      runtime.settleConPty();
      runtime.write(`${content}${HIDE_CURSOR}${RESTORE_CURSOR}`);
      return;
    }
    runtime.write(`${SAVE_CURSOR}${move}${content}${RESTORE_CURSOR}`);
  }

  /**
   * Build one cursor-locked erase payload for a whole rectangle. In particular,
   * do not acquire the ConPTY workaround once per row: that left the terminal
   * visibly blanking a poster from top to bottom before its replacement arrived.
   */
  private eraseContent(rect: SixelRect): string {
    const line = `${RESET_ATTRIBUTES}${" ".repeat(rect.width)}`;
    const output: string[] = [];
    for (let row = 0; row < rect.height; row++) {
      if (row > 0) output.push(moveTo({ x: rect.x, y: rect.y + row }));
      output.push(line);
    }
    output.push(RESET_ATTRIBUTES);
    return output.join("");
  }

  private flush(): void {
    if (this.flushing) {
      this.redrawRequested = true;
      return;
    }
    this.flushing = true;
    try {
      // Effects run after Ink committed the frame that removed or moved the
      // reserved pane. Ink has therefore already cleared the old cells. A late
      // explicit erase here would punch holes through the newly rendered UI.
      for (const [id, shown] of this.shown) {
        const next = this.desired.get(id);
        if (!next || !sameRect(shown.rect, next.rect)) {
          this.shown.delete(id);
        }
      }
      for (const [id, overlay] of this.desired) {
        const shown = this.shown.get(id);
        if (shown && shown.sixel !== overlay.sixel) {
          // Sixel's transparent background mode does not clear pixels that the
          // replacement leaves untouched. Clear and paint in one cursor lock so
          // a previous title cannot flash through or ghost around the new one.
          this.writeAt(
            overlay.rect,
            `${this.eraseContent(overlay.rect)}${moveTo(overlay.rect)}${overlay.sixel}`,
          );
        } else if (!shown || this.dirty.has(id)) {
          this.writeAt(overlay.rect, overlay.sixel);
        }
        this.shown.set(id, overlay);
        this.dirty.delete(id);
      }
    } catch (error) {
      debugImage(`sixel overlay failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.flushing = false;
      if (this.redrawRequested) {
        this.redrawRequested = false;
        this.scheduleFlush();
      }
    }
  }
}

export const sixelOverlayManager = new SixelOverlayManager();

export const __testing = { runtime, moveTo, sameRect, sameOverlay };
