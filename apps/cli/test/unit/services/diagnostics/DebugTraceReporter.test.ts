import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildDebugSessionInstructions,
  DebugTraceReporter,
  resolveTraceCategories,
} from "@/services/diagnostics/DebugTraceReporter";

describe("DebugTraceReporter", () => {
  test("writes redacted JSONL events for selected categories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-debug-trace-"));
    try {
      const filePath = join(dir, "trace.jsonl");
      const reporter = new DebugTraceReporter({
        filePath,
        categories: new Set(["provider"]),
      });

      reporter.record({
        category: "search",
        message: "ignored",
      });
      reporter.record({
        category: "provider",
        message: "provider event",
        context: {
          url: "https://cdn.example/stream.m3u8?token=secret",
        },
      });

      const lines = (await readFile(filePath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        category: "provider",
        message: "provider event",
        context: {
          url: "https://cdn.example/stream.m3u8?token=[redacted]",
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("prunes older kunai-trace files after creating a new trace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kunai-debug-trace-retain-"));
    try {
      // Stamp existing traces in the past so the newly created file is newest by mtime.
      const base = Date.now() / 1000 - 60;
      for (let index = 0; index < 10; index += 1) {
        const path = join(dir, `kunai-trace-${String(index).padStart(2, "0")}.jsonl`);
        await writeFile(path, "");
        await utimes(path, base + index, base + index);
      }

      const newest = join(dir, "kunai-trace-99.jsonl");
      const reporter = new DebugTraceReporter({ filePath: newest });
      expect(reporter).toBeDefined();
      // Constructor fires prune asynchronously; wait for retention to settle.
      await Bun.sleep(50);

      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(10);
      expect(files).toContain("kunai-trace-99.jsonl");
      expect(files).not.toContain("kunai-trace-00.jsonl");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("debug session provides default trace categories when KUNAI_TRACE is not set", () => {
    expect([...resolveTraceCategories({ debugSession: true })!]).toEqual([
      "provider",
      "playback",
      "cache",
      "network",
      "subtitle",
    ]);
  });

  test("explicit trace categories override debug session defaults", () => {
    expect([
      ...resolveTraceCategories({ explicit: "provider,cache", debugSession: true })!,
    ]).toEqual(["provider", "cache"]);
  });

  test("builds concise debug session instructions with exportable trace path", () => {
    const lines = buildDebugSessionInstructions({
      tracePath: "/tmp/kunai-trace.jsonl",
      categories: new Set(["provider", "playback"]),
    });

    expect(lines.join("\n")).toContain("/tmp/kunai-trace.jsonl");
    expect(lines.join("\n")).toContain("provider,playback");
    expect(lines.join("\n")).toContain("/export-diagnostics");
  });
});
