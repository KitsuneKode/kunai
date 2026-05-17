import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProcStatusMemory = {
  readonly name: string;
  readonly ppid: number;
  readonly rssBytes: number;
  readonly swapBytes: number;
};

export type ChildMemorySummary = {
  readonly rssBytes: number;
  readonly swapBytes: number;
  readonly count: number;
};

export type RuntimeMemorySnapshot = {
  readonly appRssBytes: number;
  readonly appHeapUsedBytes: number;
  readonly appHeapTotalBytes: number;
  readonly playbackChildRssBytes: number;
  readonly playbackChildSwapBytes: number;
  readonly playbackChildCount: number;
  readonly appSwapBytes?: number;
};

function parseKbLine(text: string, label: string): number {
  const match = new RegExp(`^${label}:\\s+(\\d+)\\s+kB$`, "m").exec(text);
  return match?.[1] ? Number.parseInt(match[1], 10) * 1024 : 0;
}

function parseStringLine(text: string, label: string): string {
  const match = new RegExp(`^${label}:\\s+(.+)$`, "m").exec(text);
  return match?.[1]?.trim() ?? "";
}

function parseNumberLine(text: string, label: string): number {
  const value = parseStringLine(text, label);
  return value ? Number.parseInt(value, 10) : 0;
}

export function parseProcStatus(text: string): ProcStatusMemory {
  return {
    name: parseStringLine(text, "Name"),
    ppid: parseNumberLine(text, "PPid"),
    rssBytes: parseKbLine(text, "VmRSS"),
    swapBytes: parseKbLine(text, "VmSwap"),
  };
}

export function summarizeChildProcessMemory(
  statuses: readonly ProcStatusMemory[],
  opts: {
    parentPid?: number;
    commandNames?: readonly string[];
  } = {},
): ChildMemorySummary {
  const parentPid = opts.parentPid ?? process.pid;
  const commandNames = new Set(opts.commandNames ?? ["mpv"]);
  let rssBytes = 0;
  let swapBytes = 0;
  let count = 0;

  for (const status of statuses) {
    if (status.ppid !== parentPid || !commandNames.has(status.name)) continue;
    rssBytes += status.rssBytes;
    swapBytes += status.swapBytes;
    count++;
  }

  return { rssBytes, swapBytes, count };
}

function readProcStatuses(procRoot: string): ProcStatusMemory[] {
  try {
    return readdirSync(procRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => {
        try {
          return parseProcStatus(readFileSync(join(procRoot, entry.name, "status"), "utf8"));
        } catch {
          return null;
        }
      })
      .filter((status): status is ProcStatusMemory => status !== null);
  } catch {
    return [];
  }
}

function readSelfStatus(procRoot: string, pid: number): ProcStatusMemory | null {
  try {
    return parseProcStatus(readFileSync(join(procRoot, String(pid), "status"), "utf8"));
  } catch {
    return null;
  }
}

export function collectRuntimeMemorySnapshot(
  opts: {
    procRoot?: string;
    parentPid?: number;
    memoryUsage?: Pick<NodeJS.MemoryUsage, "rss" | "heapUsed" | "heapTotal">;
  } = {},
): RuntimeMemorySnapshot {
  const parentPid = opts.parentPid ?? process.pid;
  const memory = opts.memoryUsage ?? process.memoryUsage();
  const procRoot = opts.procRoot ?? "/proc";
  const selfStatus = readSelfStatus(procRoot, parentPid);
  const childSummary = summarizeChildProcessMemory(readProcStatuses(procRoot), { parentPid });

  return {
    appRssBytes: selfStatus?.rssBytes || memory.rss,
    appHeapUsedBytes: memory.heapUsed,
    appHeapTotalBytes: memory.heapTotal,
    playbackChildRssBytes: childSummary.rssBytes,
    playbackChildSwapBytes: childSummary.swapBytes,
    playbackChildCount: childSummary.count,
    appSwapBytes: selfStatus?.swapBytes,
  };
}

export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function formatBytePair(usedBytes: number, totalBytes: number): string {
  const unit = Math.max(Math.abs(usedBytes), Math.abs(totalBytes)) >= 1024 ** 3 ? "GiB" : "MiB";
  const scale = unit === "GiB" ? 1024 ** 3 : 1024 ** 2;
  return `${(usedBytes / scale).toFixed(1)}/${(totalBytes / scale).toFixed(1)} ${unit}`;
}

export function formatRuntimeMemory(snapshot: RuntimeMemorySnapshot): string {
  const playbackChildLabel = snapshot.playbackChildCount > 0 ? "mpv" : "mpv";
  const totalRssBytes = snapshot.appRssBytes + snapshot.playbackChildRssBytes;
  const swapBytes = (snapshot.appSwapBytes ?? 0) + snapshot.playbackChildSwapBytes;
  const parts = [
    `App ${formatBytes(snapshot.appRssBytes)}`,
    `${playbackChildLabel} ${formatBytes(snapshot.playbackChildRssBytes)}`,
    `total ${formatBytes(totalRssBytes)}`,
    `heap ${formatBytePair(snapshot.appHeapUsedBytes, snapshot.appHeapTotalBytes)}`,
  ];

  if (swapBytes > 0) {
    parts.push(`swap ${formatBytes(swapBytes)}`);
  }

  return parts.join(" · ");
}

export function getRuntimeMemoryLine(): string {
  return formatRuntimeMemory(collectRuntimeMemorySnapshot());
}
