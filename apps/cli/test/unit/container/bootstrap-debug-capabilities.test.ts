import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrapCoreInfra, resolveDebugCapabilities } from "@/container/bootstrap-persistence";
import { initLogger, dbg } from "@/logger";

afterEach(() => {
  initLogger(false);
});

describe("debug capabilities", () => {
  test("keeps CLI file logging distinct from environment-only stderr logging", () => {
    expect(resolveDebugCapabilities(false, {})).toEqual({
      enabled: false,
      file: false,
      tracerOutputs: [],
    });
    expect(resolveDebugCapabilities(false, { KITSUNE_DEBUG: "1" })).toEqual({
      enabled: true,
      file: false,
      tracerOutputs: ["console"],
    });
    expect(resolveDebugCapabilities(true, {})).toEqual({
      enabled: true,
      file: true,
      tracerOutputs: ["console", "file"],
    });
  });

  test("environment-only debug reaches facade, child logger, and tracer without creating logs.txt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kunai-env-debug-"));
    const lines: string[] = [];
    try {
      const core = bootstrapCoreInfra(
        { debug: false },
        {
          environment: { KITSUNE_DEBUG: "1" },
          workingDirectory: directory,
          write: (line) => lines.push(line),
          isInteractiveShellMounted: () => true,
          stderrIsTTY: false,
        },
      );

      dbg("provider", "facade reached", { operation: "debug.facade" });
      core.logger.child({ module: "child" }).debug("child reached");
      await core.tracer.span("resolve", async (span) => {
        span.addEvent("tracer reached");
      });

      expect(core.debugCapabilities.enabled).toBe(true);
      expect(lines.join("\n")).toContain("facade reached");
      expect(lines.join("\n")).toContain("child reached");
      expect(lines.join("\n")).toContain("tracer reached");
      expect(existsSync(join(directory, "logs.txt"))).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("CLI debug continues writing logs.txt while the shell owns stderr", () => {
    const directory = mkdtempSync(join(tmpdir(), "kunai-cli-debug-"));
    const lines: string[] = [];
    try {
      const core = bootstrapCoreInfra(
        { debug: true },
        {
          environment: {},
          workingDirectory: directory,
          write: (line) => lines.push(line),
          isInteractiveShellMounted: () => true,
          stderrIsTTY: true,
        },
      );

      core.logger.info("file-only while Ink is mounted");

      expect(lines).toEqual([]);
      expect(readFileSync(join(directory, "logs.txt"), "utf8")).toContain(
        "file-only while Ink is mounted",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("debug-off drops debug and info while preserving warning and error behavior", async () => {
    const lines: string[] = [];
    const core = bootstrapCoreInfra(
      { debug: false },
      {
        environment: {},
        write: (line) => lines.push(line),
        isInteractiveShellMounted: () => false,
      },
    );

    dbg("provider", "hidden facade");
    core.logger.debug("hidden debug");
    core.logger.info("hidden info");
    await core.tracer.span("resolve", async (span) => span.addEvent("hidden tracer"));
    core.logger.warn("visible warning");
    core.logger.error("visible error");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("visible warning");
    expect(lines[1]).toContain("visible error");
    expect(lines.join("\n")).not.toContain("hidden");
  });
});
