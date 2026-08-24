import { readFileSync } from "node:fs";
import { hostname } from "node:os";

// Windows PowerShell startup can exceed one second on a loaded runner. Normal
// lifecycle operations allow one bounded probe and cache its positive result;
// short activation deadlines skip optional self-identity enrichment entirely.
const PROCESS_PROBE_TIMEOUT_MS = 2_000;
const OWN_PROCESS_PROBE_RETRY_DELAY_MS = 1_000;

export type ProcessStartIdLookup = (pid: number, timeoutMs?: number) => string | null;

export function normalizedHostname(): string {
  return hostname().trim().toLowerCase();
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function boundedSpawn(command: string[], timeoutMs: number) {
  return Bun.spawnSync({
    cmd: command,
    stdout: "pipe",
    stderr: "ignore",
    timeout: Math.max(1, Math.min(PROCESS_PROBE_TIMEOUT_MS, timeoutMs)),
  });
}

let cachedOwnProcessStartId: string | null | undefined;
let retryOwnProcessStartIdAfter = 0;

export function processStartId(
  pid: number,
  timeoutMs: number = PROCESS_PROBE_TIMEOUT_MS,
): string | null {
  if (pid === process.pid && cachedOwnProcessStartId !== undefined) {
    return cachedOwnProcessStartId;
  }
  if (process.platform === "win32" && timeoutMs < PROCESS_PROBE_TIMEOUT_MS) {
    return null;
  }
  if (pid === process.pid) {
    // Nullable processStartId is part of the cross-language lock schema. A
    // short acquisition must reach its filesystem attempt instead of spending
    // the entire deadline starting PowerShell solely to enrich its own record.
    if (Date.now() < retryOwnProcessStartIdAfter) {
      return null;
    }
  }

  let value: string | null = null;
  if (process.platform === "win32") {
    try {
      const powershell = Bun.which("powershell.exe") ?? Bun.which("pwsh.exe") ?? Bun.which("pwsh");
      if (powershell) {
        const result = boundedSpawn(
          [
            powershell,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$process = Get-Process -Id ${pid} -ErrorAction Stop; [Console]::Out.Write($process.StartTime.ToUniversalTime().Ticks)`,
          ],
          timeoutMs,
        );
        const ticks = result.exitCode === 0 ? result.stdout.toString().trim() : "";
        value = /^\d+$/.test(ticks) ? `windows-ticks:${ticks}` : null;
      }
    } catch {
      value = null;
    }
  } else if (process.platform === "linux") {
    try {
      const procStat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const afterName = procStat
        .slice(procStat.lastIndexOf(") ") + 2)
        .trim()
        .split(/\s+/);
      const startTicks = afterName[19];
      value = startTicks ? `linux-proc:${startTicks}` : null;
    } catch {
      value = null;
    }
  } else if (process.platform === "darwin") {
    try {
      const result = boundedSpawn(["ps", "-o", "lstart=", "-p", String(pid)], timeoutMs);
      const start =
        result.exitCode === 0 ? result.stdout.toString().trim().replace(/\s+/g, " ") : "";
      value = start ? `darwin-ps:${start}` : null;
    } catch {
      value = null;
    }
  }

  // Cache a positive identity for the process lifetime. A failed normal-budget
  // probe gets only a short negative backoff so a later operation can retry.
  if (pid === process.pid) {
    if (value !== null) {
      cachedOwnProcessStartId = value;
    } else {
      // Avoid a queued acquisition storm when a loaded Windows runner cannot
      // start PowerShell within the normal probe budget.
      retryOwnProcessStartIdAfter = Date.now() + OWN_PROCESS_PROBE_RETRY_DELAY_MS;
    }
  }
  return value;
}
