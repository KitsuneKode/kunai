// Event-loop lag monitor — a diagnostic for "input stalls then catches up".
//
// A self-correcting timer is scheduled every `intervalMs` on the MAIN thread.
// When the main loop is blocked (synchronous render, sync SQLite, a large
// synchronous stdout write, tight compute), the timer fires LATE — and that
// lateness equals how long the loop was jammed. We also sample CPU time across
// the gap: when cpu ≈ lag the thread was BUSY (CPU-bound work — rendering,
// compute, or a blocking write), versus cpu ≪ lag which means it was genuinely
// waiting. Each stall is appended to ./loop-monitor.log (never the terminal, so
// it can't corrupt the Ink TUI).
//
// Opt-in only: set KUNAI_LOOP_MONITOR=1. Inert otherwise.

import { appendFile } from "node:fs/promises";

export type LoopTickClassification = {
  /** How much later than scheduled the tick fired, in ms (>= 0). */
  readonly lagMs: number;
  /** CPU time consumed across the gap (user+system), in ms. */
  readonly cpuMs: number;
  /** True when lagMs crosses the stall threshold. */
  readonly isStall: boolean;
  /** "busy" when CPU ≈ lag (CPU-bound block); "waiting" otherwise. */
  readonly kind: "busy" | "waiting";
};

/**
 * Pure tick classifier — given the scheduled vs actual fire time, the interval,
 * the CPU micros consumed across the gap, and the stall threshold, decide
 * whether this tick represents a stall and whether it was CPU-bound.
 */
export function classifyLoopTick(input: {
  readonly scheduledAt: number;
  readonly firedAt: number;
  readonly intervalMs: number;
  readonly cpuMicros: number;
  readonly thresholdMs: number;
}): LoopTickClassification {
  const lagMs = Math.max(0, input.firedAt - input.scheduledAt - input.intervalMs);
  const cpuMs = input.cpuMicros / 1000;
  const isStall = lagMs >= input.thresholdMs;
  // Busy when CPU accounts for at least half the stall (render/compute/sync write);
  // waiting when the gap was mostly idle (e.g. a blocking syscall that yields CPU).
  const kind: "busy" | "waiting" = cpuMs >= lagMs * 0.5 ? "busy" : "waiting";
  return { lagMs, cpuMs, isStall, kind };
}

/**
 * Start the monitor (no-op unless KUNAI_LOOP_MONITOR=1). Returns a stop function.
 */
export function installEventLoopMonitor(
  env: Record<string, string | undefined> = process.env,
): () => void {
  if (env.KUNAI_LOOP_MONITOR !== "1") return () => {};

  const intervalMs = Number.parseInt(env.KUNAI_LOOP_MONITOR_INTERVAL_MS ?? "", 10) || 50;
  const thresholdMs = Number.parseInt(env.KUNAI_LOOP_MONITOR_THRESHOLD_MS ?? "", 10) || 60;
  const logPath = env.KUNAI_LOOP_MONITOR_FILE ?? "./loop-monitor.log";

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledAt = Date.now();
  let lastCpu = process.cpuUsage();
  let stallCount = 0;
  let maxLag = 0;

  const write = (line: string): void => {
    void appendFile(logPath, line).catch(() => {});
  };

  write(
    `\n=== loop-monitor start ${new Date().toISOString()} interval=${intervalMs}ms threshold=${thresholdMs}ms ===\n`,
  );

  const tick = (): void => {
    if (stopped) return;
    const firedAt = Date.now();
    const cpu = process.cpuUsage(lastCpu);
    const result = classifyLoopTick({
      scheduledAt,
      firedAt,
      intervalMs,
      cpuMicros: cpu.user + cpu.system,
      thresholdMs,
    });
    if (result.isStall) {
      stallCount += 1;
      maxLag = Math.max(maxLag, result.lagMs);
      write(
        `${new Date(firedAt).toISOString()} STALL ${result.lagMs}ms (${result.kind}, cpu=${Math.round(
          result.cpuMs,
        )}ms) #${stallCount} maxLag=${maxLag}ms\n`,
      );
    }
    lastCpu = process.cpuUsage();
    scheduledAt = Date.now();
    timer = setTimeout(tick, intervalMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  timer = setTimeout(tick, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    write(
      `=== loop-monitor stop ${new Date().toISOString()} stalls=${stallCount} maxLag=${maxLag}ms ===\n`,
    );
  };
}
