import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Opt-in heap profiler for hunting the anime-mode (`-a`) memory runaway. Enabled
// only when KUNAI_HEAP_PROFILE=1, so it is inert in normal use. It:
//   • samples RSS to a CSV so you can see the growth rate,
//   • on SIGUSR2 (or when RSS crosses a hard cap) captures a heap snapshot and
//     prints the object types that grew most since startup — a pasteable answer,
//   • self-terminates at the cap so a runaway can never balloon the machine.
//
// JSC "Inspector" v3 heap snapshots lay out `nodes` as flat groups of 4 ints
// with the class-name index at offset 2 (verified empirically on Bun 1.3.x).
const NODE_FIELD_COUNT = 4;
const CLASS_NAME_OFFSET = 2;

export type HeapSnapshotLike = {
  readonly nodes: ArrayLike<number>;
  readonly nodeClassNames: readonly string[];
};

/** Count live heap nodes per class name. */
export function classNameHistogram(snapshot: HeapSnapshotLike): Map<string, number> {
  const counts = new Map<string, number>();
  const { nodes, nodeClassNames } = snapshot;
  for (let i = 0; i + CLASS_NAME_OFFSET < nodes.length; i += NODE_FIELD_COUNT) {
    const idx = nodes[i + CLASS_NAME_OFFSET] as number;
    const name = nodeClassNames[idx] ?? `?#${idx}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export type ClassGrowth = { name: string; from: number; to: number; delta: number };

/** Class names ranked by growth between a baseline and a current histogram. */
export function topGrowth(
  baseline: Map<string, number>,
  current: Map<string, number>,
  limit = 20,
): ClassGrowth[] {
  const rows: ClassGrowth[] = [];
  for (const [name, to] of current) {
    const from = baseline.get(name) ?? 0;
    rows.push({ name, from, to, delta: to - from });
  }
  return rows.sort((a, b) => b.delta - a.delta).slice(0, limit);
}

export function formatGrowthReport(reason: string, growth: readonly ClassGrowth[]): string {
  const lines = growth.map(
    (r) => `${String(r.delta).padStart(10)}  ${r.name} (${r.from} → ${r.to})`,
  );
  return `\n[heap-profile] ${reason} — top object-type growth since start:\n${lines.join("\n")}\n`;
}

export function installHeapProfiler(): void {
  const dir = process.env.KUNAI_HEAP_DIR ?? join(homedir(), "kunai-heap-profile");
  mkdirSync(dir, { recursive: true });
  const capMb = Number.parseInt(process.env.KUNAI_HEAP_CAP_MB ?? "2048", 10);
  const sampleMs = Number.parseInt(process.env.KUNAI_HEAP_SAMPLE_MS ?? "5000", 10);
  const rssCsv = join(dir, "rss.csv");
  const startedAt = Date.now();
  writeFileSync(rssCsv, "elapsed_s,rss_mb,heap_used_mb\n");

  const baseline = classNameHistogram(Bun.generateHeapSnapshot() as unknown as HeapSnapshotLike);

  const report = (reason: string): void => {
    const snap = Bun.generateHeapSnapshot();
    const growth = topGrowth(baseline, classNameHistogram(snap as unknown as HeapSnapshotLike));
    const summary = formatGrowthReport(reason, growth);
    process.stderr.write(summary);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(dir, `growth-${reason}-${ts}.txt`), summary);
    try {
      writeFileSync(join(dir, `heap-${reason}-${ts}.json`), JSON.stringify(snap));
    } catch {
      // A multi-GB snapshot may fail to serialize; the growth summary is the key artifact.
    }
  };

  process.on("SIGUSR2", () => report("manual"));

  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / 1048576);
    const el = Math.round((Date.now() - startedAt) / 1000);
    appendFileSync(rssCsv, `${el},${rssMb},${Math.round(mem.heapUsed / 1048576)}\n`);
    if (rssMb >= capMb) {
      process.stderr.write(
        `\n[heap-profile] RSS ${rssMb}MB >= cap ${capMb}MB — capturing and exiting to protect the machine.\n`,
      );
      report("cap");
      process.exit(70);
    }
  }, sampleMs);
  timer.unref?.();

  process.stderr.write(
    `[heap-profile] active -> ${dir} | RSS cap ${capMb}MB | sample ${sampleMs}ms | SIGUSR2 for a snapshot\n`,
  );
}
