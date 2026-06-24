import { describe, expect, test } from "bun:test";

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
});
