import { describe, expect, test } from "bun:test";

import { buildDiagnosticsSupportBundle } from "@/services/diagnostics/support-bundle";

describe("buildDiagnosticsSupportBundle", () => {
  test("builds a redacted support bundle with runtime metadata", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "1.2.3",
      debug: true,
      capabilities: {
        mpv: true,
        ytDlp: false,
        notes: ["https://example.com/internal"],
      },
      events: [
        {
          timestamp: 1,
          level: "info",
          category: "provider",
          operation: "provider.resolve",
          message: "Resolved",
          context: {
            url: "https://cdn.example/stream.m3u8?token=secret",
            status: 200,
          },
        },
      ],
      now: () => new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(bundle.exportedAt).toBe("2026-05-14T00:00:00.000Z");
    expect(bundle.app).toEqual({ version: "1.2.3", debug: true });
    expect(bundle.runtime.platform).toBe(process.platform);
    expect(bundle.eventCount).toBe(1);
    expect(bundle.capabilities).toEqual({
      mpv: true,
      ytDlp: false,
      notes: ["[redacted-url]"],
    });
    expect(bundle.events[0]?.context).toEqual({
      url: "[redacted-url]",
      status: 200,
    });
  });
});
