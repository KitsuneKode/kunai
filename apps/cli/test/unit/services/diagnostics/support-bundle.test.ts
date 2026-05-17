import { describe, expect, test } from "bun:test";

import { buildDiagnosticsSupportBundle } from "@/services/diagnostics/support-bundle";

describe("DiagnosticsSupportBundle", () => {
  test("builds layered summary and section metadata", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      events: [
        {
          timestamp: 1,
          category: "provider",
          level: "info",
          operation: "provider.resolve",
          message: "Provider resolve started",
        },
        {
          timestamp: 2,
          category: "network",
          level: "warn",
          operation: "network.snapshot",
          message: "Network unavailable",
        },
      ],
    });

    expect(bundle.summary.headline).toBe("Network unavailable");
    expect(bundle.summary.sections).toEqual(["network", "provider"]);
    expect(bundle.sections.network).toMatchObject({ tone: "warning", eventCount: 1 });
    expect(bundle.sections.provider).toMatchObject({ tone: "neutral", eventCount: 1 });
  });

  test("summarizes presence and download sections with latest operation details", () => {
    const bundle = buildDiagnosticsSupportBundle({
      appVersion: "0.1.0",
      debug: true,
      now: () => new Date("2026-05-16T00:00:00.000Z"),
      events: [
        {
          timestamp: 1,
          category: "presence",
          level: "warn",
          operation: "presence.clear.failed",
          message: "Presence clear failed",
        },
        {
          timestamp: 2,
          category: "download",
          level: "info",
          operation: "download.artifact.validated",
          message: "Download artifact validated",
        },
      ],
    });

    expect(bundle.summary.sections).toEqual(["presence", "download"]);
    expect(bundle.sections.presence).toMatchObject({
      tone: "warning",
      eventCount: 1,
      latestOperation: "presence.clear.failed",
      latestMessage: "Presence clear failed",
    });
    expect(bundle.sections.download).toMatchObject({
      tone: "neutral",
      latestOperation: "download.artifact.validated",
    });
  });
});
