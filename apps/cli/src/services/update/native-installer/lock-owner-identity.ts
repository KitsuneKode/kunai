import { readFileSync } from "node:fs";
import { hostname } from "node:os";

// Windows PowerShell startup can exceed 250 ms on a cold CI runner. Give the
// first self-identity lookup enough time to succeed so its positive result is
// cached; callers with a shorter deadline still clamp this bound below.
const PROCESS_PROBE_TIMEOUT_MS = 1_000;

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

export function processStartId(
  pid: number,
  timeoutMs: number = PROCESS_PROBE_TIMEOUT_MS,
): string | null {
  if (pid === process.pid && cachedOwnProcessStartId !== undefined) {
    return cachedOwnProcessStartId;
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

  // A short caller deadline can make a helper probe time out. Cache only a
  // positive identity so a later normal-budget acquisition can retry.
  if (pid === process.pid && value !== null) cachedOwnProcessStartId = value;
  return value;
}
