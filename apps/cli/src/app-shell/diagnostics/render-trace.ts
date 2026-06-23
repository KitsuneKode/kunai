// =============================================================================
// render-trace.ts — debug-gated render / keystroke / poster instrumentation.
//
// Purpose: answer "where does the per-keystroke latency go?" with real numbers
// on the user's terminal, since the chafa/Kitty poster cost cannot be reproduced
// in tests (no image renderer in CI). All output goes through the existing
// `dbg(...)` debug logger, so it is a no-op unless `--debug` / KITSUNE_DEBUG=1.
//
// What it measures:
//   • recordRender(surface)    — render count per surface, and whether a render
//                                happened while IDLE (no recent keystroke), which
//                                flags background-timer-driven full-frame redraws.
//   • recordKeystroke(surface) — logs how many renders the PREVIOUS keystroke
//                                caused (render fan-out per key).
//   • recordPosterFetch(...)   — counts poster fetches, cache hits, and renderer
//                                subprocess spawns (the event-loop hog).
//
// Read the numbers with:  bun run dev -- --debug 2> debug.log
// then grep debug.log for `"module":"render-trace"`.
// =============================================================================

import { dbg } from "@/logger";

const MODULE = "render-trace";

// A render landing this long after the last keystroke is attributed to a
// background source (timers, presence, notifications) rather than the keypress
// cascade. The keystroke cascade (selection -> 150ms settle -> companion/poster)
// completes well under this window, so anything beyond it is "idle churn".
const IDLE_RENDER_MS = 500;

type SurfaceTrace = {
  renders: number;
  rendersSinceKey: number;
  idleRenders: number;
  lastKeyAt: number;
};

const surfaces = new Map<string, SurfaceTrace>();

function surfaceTrace(surface: string): SurfaceTrace {
  let trace = surfaces.get(surface);
  if (!trace) {
    trace = { renders: 0, rendersSinceKey: 0, idleRenders: 0, lastKeyAt: 0 };
    surfaces.set(surface, trace);
  }
  return trace;
}

/** Call once per render of a surface (top of the component body). */
export function recordRender(surface: string): void {
  const trace = surfaceTrace(surface);
  trace.renders += 1;
  trace.rendersSinceKey += 1;
  const sinceKey = trace.lastKeyAt === 0 ? Number.POSITIVE_INFINITY : Date.now() - trace.lastKeyAt;
  if (sinceKey > IDLE_RENDER_MS) {
    trace.idleRenders += 1;
    dbg(MODULE, "idle render", {
      surface,
      totalRenders: trace.renders,
      idleRenders: trace.idleRenders,
      msSinceKey: Number.isFinite(sinceKey) ? Math.round(sinceKey) : null,
    });
  }
}

/** Call at the start of a surface's input handler. Logs the previous key's fan-out. */
export function recordKeystroke(surface: string, key?: string): void {
  const trace = surfaceTrace(surface);
  dbg(MODULE, "keystroke", {
    surface,
    key,
    rendersForPrevKey: trace.rendersSinceKey,
  });
  trace.rendersSinceKey = 0;
  trace.lastKeyAt = Date.now();
}

const posterStats = {
  calls: 0,
  cacheHits: 0,
  misses: 0,
  spawns: 0,
};

/**
 * Call from the poster fetch path. `spawned` marks a real renderer subprocess
 * (chafa/Kitty) being launched — the work that competes with stdin handling.
 */
export function recordPosterFetch(info: {
  readonly cacheHit: boolean;
  readonly spawned?: boolean;
  readonly renderer?: string;
}): void {
  posterStats.calls += 1;
  if (info.cacheHit) posterStats.cacheHits += 1;
  else posterStats.misses += 1;
  if (info.spawned) posterStats.spawns += 1;
  dbg(MODULE, "poster fetch", {
    cacheHit: info.cacheHit,
    spawned: info.spawned ?? false,
    renderer: info.renderer,
    calls: posterStats.calls,
    cacheHits: posterStats.cacheHits,
    misses: posterStats.misses,
    spawns: posterStats.spawns,
  });
}

/**
 * Why a keypress did not reach a surface's action handler. Lets `--debug` answer
 * "why was this key ignored?" — the recurring class of input-routing bug where a
 * first press appears dropped (locked overlay, stale command mode, disabled binding,
 * or a letter owned by a sibling playback handler).
 */
export type InputDropReason =
  | "input-locked"
  | "command-mode"
  | "overlay-blocked"
  | "binding-disabled"
  | "no-binding"
  | "handled-externally";

export function recordInputDrop(surface: string, reason: InputDropReason, key?: string): void {
  dbg(MODULE, "input drop", { surface, reason, key });
}

/** Test seam: reset all accumulated counters. */
export function __resetRenderTrace(): void {
  surfaces.clear();
  posterStats.calls = 0;
  posterStats.cacheHits = 0;
  posterStats.misses = 0;
  posterStats.spawns = 0;
}
