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
});
