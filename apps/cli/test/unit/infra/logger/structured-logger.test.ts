import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StructuredLogger } from "@/infra/logger/StructuredLogger";
import { redactDiagnosticValue } from "@/services/diagnostics/redaction";

describe("StructuredLogger", () => {
  test("retains child context in captured output", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({
      debug: true,
      write: (line) => lines.push(line),
    });

    logger.child({ playbackCycleId: "cycle-1" }).info("Playback started", {
      operation: "playback.start",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Playback started");
    expect(lines[0]).toContain('"playbackCycleId":"cycle-1"');
    expect(lines[0]).toContain('"operation":"playback.start"');
  });

  test("warn and error emit even when debug mode is off", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({
      debug: false,
      write: (line) => lines.push(line),
    });

    logger.debug("hidden debug");
    logger.info("hidden info");
    logger.warn("visible warn");
    logger.error("visible error");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("visible warn");
    expect(lines[1]).toContain("visible error");
  });

  test("suppresses console writes when console output is disabled dynamically", () => {
    const lines: string[] = [];
    let consoleEnabled = true;
    const logger = new StructuredLogger({
      debug: false,
      console: () => consoleEnabled,
      write: (line) => lines.push(line),
    });

    logger.error("visible before shell");
    consoleEnabled = false;
    logger.error("hidden while shell owns terminal");
    consoleEnabled = true;
    logger.warn("visible after shell");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("visible before shell");
    expect(lines[1]).toContain("visible after shell");
    expect(lines.join("")).not.toContain("hidden while shell owns terminal");
  });

  test("sanitizes log messages and context before serializing captured output", () => {
    const lines: string[] = [];
    const home = process.env.HOME ?? "/home/tester";
    const logger = new StructuredLogger({
      debug: true,
      write: (line) => lines.push(line),
      sanitize: (value) => redactDiagnosticValue(value, { homeDir: home }),
    });

    logger.info(
      `Could not open ${home}/Videos/Kunai/S01E01.mkv from https://cdn.example/stream.m3u8?X-Amz-Signature=secret`,
      {
        streamUrl: "https://cdn.example/stream.m3u8?X-Amz-Credential=credential&quality=1080p",
        subtitlePath: `${home}/subs/en.vtt`,
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("~/Videos/Kunai/S01E01.mkv");
    expect(lines[0]).toContain("X-Amz-Signature=[redacted]");
    expect(lines[0]).toContain('"subtitlePath":"~/subs/en.vtt"');
    expect(lines[0]).toContain("X-Amz-Credential=[redacted]");
    expect(lines[0]).not.toContain(home);
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).not.toContain("credential");
  });

  test("writes redacted entries to the file sink while console output is disabled", () => {
    const directory = mkdtempSync(join(tmpdir(), "kunai-structured-log-"));
    const file = join(directory, "logs.txt");
    try {
      const logger = new StructuredLogger({
        debug: true,
        console: false,
        file,
        sanitize: (value) => redactDiagnosticValue(value),
      });

      logger.child({ module: "player" }).info("Resolved stream", {
        token: "super-secret",
        streamUrl: "https://cdn.example/video.m3u8?signature=also-secret",
      });

      const contents = readFileSync(file, "utf8");
      expect(contents).toContain("Resolved stream");
      expect(contents).toContain('"module":"player"');
      expect(contents).toContain("[redacted]");
      expect(contents).not.toContain("super-secret");
      expect(contents).not.toContain("also-secret");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
