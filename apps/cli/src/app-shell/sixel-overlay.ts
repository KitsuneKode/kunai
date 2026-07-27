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
 * this manager is responsible for repainting the sixel after every Ink commit
 * and for explicitly clearing rectangles that are removed or moved. This is the
 * same ownership split Yazi uses for its `shown` and collision handling.
 */
export class SixelOverlayManager {
  private readonly desired = new Map<string, SixelOverlay>();
  private readonly shown = new Map<string, SixelRect>();
  private flushQueued = false;
  private flushing = false;
  private redrawRequested = false;

  register(id: string, overlay: SixelOverlay): void {
    const previous = this.desired.get(id);
    if (sameOverlay(previous, overlay)) return;
    this.desired.set(id, overlay);
    this.scheduleFlush();
  }

  unregister(id: string): void {
    if (!this.desired.delete(id)) return;
    this.scheduleFlush();
  }

  /** Called from Ink's onRender hook; deferral ensures Ink writes first. */
  afterInkRender(): void {
    this.scheduleFlush();
  }

  clear(): void {
    this.desired.clear();
    this.scheduleFlush();
  }

  /** Drop state when Ink leaves the alternate screen; do not write to primary. */
  discard(): void {
    this.desired.clear();
    this.shown.clear();
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

  private erase(rect: SixelRect): void {
    const line = " ".repeat(rect.width);
    for (let row = 0; row < rect.height; row++) {
      this.writeAt({ ...rect, y: rect.y + row, height: 1 }, `${line}${RESET_ATTRIBUTES}`);
    }
  }

  private flush(): void {
    if (this.flushing) {
      this.redrawRequested = true;
      return;
    }
    this.flushing = true;
    try {
      // Sixel has no delete command. Erase a removed or moved image before
      // painting its replacement, otherwise it remains visible below Ink.
      for (const [id, rect] of this.shown) {
        const next = this.desired.get(id);
        if (!next || !sameRect(rect, next.rect)) {
          this.erase(rect);
          this.shown.delete(id);
        }
      }
      for (const [id, overlay] of this.desired) {
        this.writeAt(overlay.rect, overlay.sixel);
        this.shown.set(id, overlay.rect);
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
