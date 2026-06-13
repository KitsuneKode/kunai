// Always-on memory safety net. A runaway (e.g. the closed-terminal anime-mode
// loop) can JAM the main event loop with synchronous allocation — so signal
// handlers and `setInterval`-based caps never fire, and RSS climbs into the tens
// of GB until it takes down the machine. The watchdog runs on a SEPARATE Worker
// thread, so it keeps polling RSS even while the main thread is jammed, and
// `SIGKILL`s the process if it crosses a cap (SIGKILL is uncatchable, so it works
// regardless of event-loop state). Disable with KUNAI_NO_MEMORY_GUARD=1.
//
// The worker is created from an INLINE blob URL (not a separate file) so it is
// always present in dev, the npm bundle, and `bun build --compile` binaries —
// Bun's bundler does not emit `new Worker(new URL(...))` entries in this setup.

const DEFAULT_CAP_MB = 1536;

export function memoryCapMb(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.KUNAI_MEM_CAP_MB ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CAP_MB;
}

/** Parse VmRSS (in KB) from the contents of /proc/<pid>/status. */
export function parseVmRssKb(statusText: string): number | null {
  const match = statusText.match(/^VmRSS:\s+(\d+)\s*kB/m);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

export function exceedsMemoryCap(rssBytes: number, capMb: number): boolean {
  return rssBytes / 1048576 >= capMb;
}

// Self-contained worker source (no backslashes → no template-escaping hazards;
// the VmRSS parse mirrors parseVmRssKb above without a regex).
const WATCHDOG_WORKER_SOURCE = `
import { readFileSync } from "node:fs";
const NL = String.fromCharCode(10);
const cap = (() => { const r = Number.parseInt(process.env.KUNAI_MEM_CAP_MB ?? "", 10); return Number.isFinite(r) && r > 0 ? r : ${DEFAULT_CAP_MB}; })();
const pid = process.pid;
function rssMb() {
  try {
    const txt = readFileSync("/proc/" + pid + "/status", "utf8");
    for (const line of txt.split(NL)) {
      if (line.startsWith("VmRSS:")) {
        return Number.parseInt(line.replace("VmRSS:", "").trim(), 10) / 1024;
      }
    }
  } catch (e) {}
  return process.memoryUsage().rss / 1048576;
}
(async () => {
  for (;;) {
    await Bun.sleep(2000);
    const mb = rssMb();
    if (mb >= cap) {
      process.stderr.write(NL + "[kunai] memory guard: RSS " + Math.round(mb) + "MB >= cap " + cap + "MB — terminating to protect your system (runaway after the terminal closed). Set KUNAI_MEM_CAP_MB to adjust or KUNAI_NO_MEMORY_GUARD=1 to disable." + NL);
      process.kill(pid, "SIGKILL");
      return;
    }
  }
})();
`;

/** Spawn the watchdog Worker (no-op if disabled or unsupported). */
export function installMemoryWatchdog(): void {
  if (process.env.KUNAI_NO_MEMORY_GUARD === "1") return;
  try {
    const url = URL.createObjectURL(
      new Blob([WATCHDOG_WORKER_SOURCE], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    // Never let the watchdog keep the process alive on its own.
    (worker as unknown as { unref?: () => void }).unref?.();
  } catch {
    // Workers / Blob URLs unavailable in this runtime — skip silently.
  }
}
