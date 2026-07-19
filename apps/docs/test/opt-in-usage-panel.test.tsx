import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  OptInUsagePanel,
  TelemetryMetricsEmpty,
  TelemetryZeroDayEmpty,
} from "../components/telemetry/opt-in-usage-panel";

const sample = {
  schemaVersion: 1 as const,
  day: "2026-07-19",
  activeInstalls: 1284,
  lifetimeInstallsApprox: 15200,
  lifetimeMethod: "hyperloglog" as const,
  updatedAt: "2026-07-20T00:05:00.000Z",
};

describe("opt-in usage panel", () => {
  test("renders empty state when metrics are unavailable", () => {
    const html = renderToStaticMarkup(<OptInUsagePanel metrics={null} />);
    expect(html).toContain("Public pulse not published yet");
    expect(html).toContain("Exact wire payload");
    expect(html).not.toContain("Public opt-in pulse");
  });

  test("renders metrics heroes and zero-day empty when actives are zero", () => {
    const html = renderToStaticMarkup(
      <OptInUsagePanel metrics={{ ...sample, activeInstalls: 0 }} />,
    );
    expect(html).toContain("No opt-in pings for 2026-07-19");
    expect(html).toContain("Yesterday");
    expect(html).toContain("Lifetime opt-in estimate");
  });

  test("renders populated pulse without empty copy", () => {
    const html = renderToStaticMarkup(<OptInUsagePanel metrics={sample} />);
    expect(html).toContain("1,284");
    expect(html).toContain("~15,200");
    expect(html).not.toContain("Public pulse not published yet");
    expect(html).not.toContain("No opt-in pings");
  });

  test("empty blocks expose recovery links", () => {
    expect(renderToStaticMarkup(<TelemetryMetricsEmpty />)).toContain(
      "reliability-and-privacy#opt-in-telemetry",
    );
    expect(renderToStaticMarkup(<TelemetryZeroDayEmpty day="2026-07-19" />)).toContain(
      "2026-07-19",
    );
  });
});
