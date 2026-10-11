// =============================================================================
// mouse-stdin.ts — a stdin *facade* for Ink.
//
// Ink consumes stdin through the `readable`/`read()` contract — and a known
// trap in this codebase is that attaching a `data` listener to the real stdin
// puts it in flowing mode, which fights Ink's read loop and (worse) Bun's TTY
// stdin does not reliably emit `data` in raw mode at all. So the facade keeps
// the SAME contract on both sides:
//
//   real stdin 'readable'  →  proxy emits 'readable'
//   Ink calls proxy.read() →  proxy drains source.read(), splits SGR mouse
//                             reports out (dispatching them to the
//                             MouseDispatcher), and returns only clean
//                             keyboard bytes.
//
// Nothing ever flows unconsumed; a chunk that is 100% mouse bytes just makes
// read() return null, which is how Ink's drain loop naturally terminates.
// =============================================================================

import { EventEmitter } from "node:events";

import type { MouseDispatcher } from "./MouseRegions";
import {
  MOUSE_TRACKING_DISABLE,
  MOUSE_TRACKING_ENABLE,
  splitMouseSequences,
} from "./terminal-mouse";

/** The byte shapes a Node readable stdin can hand us once encoding is off. */
type StdinChunk = string | Buffer | Uint8Array;

type StdinLike = EventEmitter & {
  read(): StdinChunk | null;
  setEncoding(encoding: BufferEncoding): void;
  setRawMode?(mode: boolean): void;
  isTTY?: boolean;
  ref?(): void;
  unref?(): void;
  unshift?(chunk: StdinChunk): void;
  pause?(): void;
  resume?(): void;
  isPaused?(): boolean;
};

function chunkToText(chunk: StdinChunk): string {
  // Real readable streams may supply text or bytes; normalize at this I/O boundary.
  // eslint-disable-next-line anti-slop/no-runtime-typeof
  return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
}

const PENDING_TAIL_LIMIT = 64;
const PENDING_TAIL_IDLE_MS = 50;

function scheduleTailFlush(flush: () => void): () => void {
  const timer = setTimeout(flush, PENDING_TAIL_IDLE_MS);
  timer.unref();
  return () => clearTimeout(timer);
}

export class MouseSplitStdin extends EventEmitter {
  private readonly buffer: string[] = [];
  private pendingTail = "";
  private readonly onSourceReadable: () => void;
  private tracking = false;
  private detached = false;
  private readonly stdoutWrite: (data: string) => void;
  private readonly scheduleTailFlush: (flush: () => void) => () => void;
  private cancelTailFlush: (() => void) | null = null;

  constructor(
    private readonly source: StdinLike,
    private readonly dispatcher: MouseDispatcher | null,
    options: {
      /** Defaults to `process.stdout.write`. Injectable for tests. */
      readonly write?: (data: string) => void;
      /** Returns cancellation; tests drive idle expiry without wall-clock sleeps. */
      readonly scheduleTailFlush?: (flush: () => void) => () => void;
    } = {},
  ) {
    super();
    this.stdoutWrite = options.write ?? ((data) => process.stdout.write(data));
    this.scheduleTailFlush = options.scheduleTailFlush ?? scheduleTailFlush;
    this.onSourceReadable = () => this.emit("readable");
  }

  /** Start forwarding. Call once, before render() mounts Ink. */
  attach(): void {
    this.source.on("readable", this.onSourceReadable);
  }

  /** Stop forwarding and restore terminal mouse tracking if it was enabled. */
  detach(): void {
    this.detached = true;
    this.cancelTailFlush?.();
    this.cancelTailFlush = null;
    this.pendingTail = "";
    this.buffer.length = 0;
    this.source.removeListener("readable", this.onSourceReadable);
    this.disableTracking();
  }

  enableTracking(): void {
    if (this.tracking) return;
    this.tracking = true;
    this.stdoutWrite(MOUSE_TRACKING_ENABLE);
  }

  disableTracking(): void {
    if (!this.tracking) return;
    this.tracking = false;
    this.stdoutWrite(MOUSE_TRACKING_DISABLE);
  }

  // -- Input side: one source chunk → mouse events + clean-byte queue --------

  private ingest(chunk: StdinChunk): void {
    this.cancelTailFlush?.();
    this.cancelTailFlush = null;
    const text = chunkToText(chunk);
    const { input, events, pendingTail } = splitMouseSequences(this.pendingTail + text);
    if (input.length > 0) {
      this.buffer.push(input);
      this.emit("data", input);
    }
    if (pendingTail.length > PENDING_TAIL_LIMIT) {
      // Runaway partial (never-terminated `\x1b[<…`): release it as input
      // rather than eating bytes forever. `pendingTail` already absorbed the
      // carried-over prefix — it follows the clean input positionally.
      this.buffer.push(pendingTail);
      this.pendingTail = "";
    } else {
      this.pendingTail = pendingTail;
      if (pendingTail) {
        this.cancelTailFlush = this.scheduleTailFlush(() => {
          this.cancelTailFlush = null;
          if (this.detached || !this.pendingTail) return;
          // Preserve bytes: an incomplete report is indistinguishable from
          // someone typing digits and semicolons after a damaged prefix.
          this.buffer.push(this.pendingTail);
          this.pendingTail = "";
          this.emit("readable");
        });
      }
    }
    for (const event of events) {
      const handled = this.dispatcher?.dispatch(event) === true;
      // Fallback: a wheel tick over unregistered space scrolls whatever is
      // focused — every list in the app gets wheel support without per-surface
      // wiring. Regions can override with their own onWheel.
      if (!handled && event.kind === "wheel") {
        this.buffer.push(event.button === "wheel-up" ? "\x1b[A" : "\x1b[B");
      }
    }
  }

  // -- Ink-facing readable contract ------------------------------------------

  /**
   * Ink's drain loop calls this until null. Each call first drains the real
   * stream (which is exactly what `readable` signalled), then returns the next
   * clean chunk. An all-mouse chunk yields null — the loop just exits.
   */
  read(): string | null {
    if (!this.detached) {
      for (;;) {
        const chunk = this.source.read();
        if (chunk === null || chunk === undefined) break;
        this.ingest(chunk);
      }
    }
    return this.buffer.shift() ?? null;
  }

  /** Ink pushes bytes back (e.g. kitty-protocol leftovers). Re-queue them. */
  unshift(chunk: StdinChunk | null | undefined): void {
    if (chunk === undefined || chunk === null) return;
    this.buffer.unshift(chunkToText(chunk));
    this.emit("readable");
  }

  setEncoding(encoding: BufferEncoding): void {
    this.source.setEncoding(encoding);
  }

  setRawMode(mode: boolean): void {
    this.source.setRawMode?.(mode);
  }

  get isTTY(): boolean {
    return this.source.isTTY === true;
  }

  ref(): void {
    this.source.ref?.();
  }

  unref(): void {
    this.source.unref?.();
  }

  pause(): void {
    this.source.pause?.();
  }

  resume(): void {
    this.source.resume?.();
  }

  isPaused(): boolean {
    return this.source.isPaused?.() ?? false;
  }
}
