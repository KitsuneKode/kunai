import { describe, expect, test } from "bun:test";

import {
  formatOptInTelemetryLine,
  parseDocsTelemetryMetrics,
  resolveTelemetryMetricsUrl,
} from "../lib/telemetry-metrics";

const sample = {
  schemaVersion: 1 as const,
  day: "2026-07-19",
  activeInstalls: 1284,
  lifetimeInstallsApprox: 15200,
  lifetimeMethod: "hyperloglog" as const,
  updatedAt: "2026-07-20T00:05:00.000Z",
};

describe("docs telemetry metrics", () => {
  test("parses the public aggregate schema and rejects identity fields", () => {
    expect(parseDocsTelemetryMetrics(sample)).toEqual(sample);
    expect(parseDocsTelemetryMetrics({ ...sample, installId: "nope" })).toBeNull();
    expect(parseDocsTelemetryMetrics({ ...sample, schemaVersion: 2 })).toBeNull();
  });

  test("formats a quiet home line", () => {
    expect(formatOptInTelemetryLine(sample)).toBe(
      "Opt-in installs on 2026-07-19: 1284 · lifetime ~15200",
    );
  });

  test("resolves metrics URL from env with default fallback", () => {
    expect(resolveTelemetryMetricsUrl({})).toContain("metrics/daily.json");
    expect(
      resolveTelemetryMetricsUrl({
        KUNAI_TELEMETRY_METRICS_URL: "https://example.test/metrics/daily.json",
      }),
    ).toBe("https://example.test/metrics/daily.json");
  });
});
