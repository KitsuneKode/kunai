import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_TASKS = [
  "@kitsunekode/kunai#build",
  "@kitsunekode/kunai#build:binary:host",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Verify task identities, not the number of unrelated dependency cache hits. */
export function assertBuildCacheHits(summary: unknown): void {
  if (!isRecord(summary) || !Array.isArray(summary.tasks)) {
    throw new Error("[verify:build-pipeline] malformed Turbo summary: expected a tasks array");
  }
  const entries: readonly unknown[] = summary.tasks;
  const tasks = entries.map((task) => {
    if (!isRecord(task) || typeof task.taskId !== "string") {
      throw new Error("[verify:build-pipeline] malformed Turbo summary task: expected taskId");
    }
    return task;
  });
  for (const taskId of REQUIRED_TASKS) {
    const matches = tasks.filter((task) => task.taskId === taskId);
    if (matches.length !== 1) {
      throw new Error(
        `[verify:build-pipeline] expected exactly one summary entry for ${taskId}, got ${matches.length}`,
      );
    }
    const cache = matches[0]?.cache;
    if (!isRecord(cache) || typeof cache.status !== "string") {
      throw new Error(`[verify:build-pipeline] malformed cache status for ${taskId}`);
    }
    if (cache.status !== "HIT") {
      throw new Error(
        `[verify:build-pipeline] expected cache HIT for ${taskId}, got ${cache.status}`,
      );
    }
  }
}

/** Read only the summary path reported by this invocation, never a historical run. */
export function assertBuildCacheSummary(output: string, cwd: string): void {
  const paths = Bun.stripANSI(output)
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^Summary:\s+(.+\.json)\s*$/.exec(line);
      return match?.[1] ? [match[1]] : [];
    });
  const summaryPath = paths[0];
  if (paths.length !== 1 || !summaryPath) {
    throw new Error(
      `[verify:build-pipeline] expected one Turbo Summary path from this invocation, got ${paths.length}`,
    );
  }
  const path = resolve(cwd, summaryPath);
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`[verify:build-pipeline] could not read Turbo summary: ${path}`, { cause });
  }
  let summary: unknown;
  try {
    summary = JSON.parse(content);
  } catch (cause) {
    throw new Error(`[verify:build-pipeline] malformed Turbo summary JSON: ${path}`, { cause });
  }
  assertBuildCacheHits(summary);
}
