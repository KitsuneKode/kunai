import { describe, expect, test } from "bun:test";

import { buildDiagnosticsSections } from "@/app-shell/diagnostics-dashboard-model";
import type {
  DiagnosticSeverity,
  DiagnosticsHealthRow,
  DiagnosticsSubsystem,
} from "@/services/diagnostics/diagnostics-insight";

function row(
  subsystem: DiagnosticsSubsystem,
  severity: DiagnosticSeverity,
  reason = "",
): DiagnosticsHealthRow {
  return {
    subsystem,
    severity,
    label: subsystem,
    reason,
    recommendedAction: "none",
    recommendedActionLabel: "",
  };
}

describe("buildDiagnosticsSections", () => {
  test("separates unknown from broken", () => {
    const sections = buildDiagnosticsSections([
      row("discord", "blocked", "Could not connect"),
      row("provider", "unknown", "no resolve traces yet"),
      row("cache", "healthy", "No cache issue"),
    ]);

    const byId = Object.fromEntries(
      sections.map((section) => [section.id, section.rows.map((r) => r.subsystem)]),
    );
    // Unknown must never sit in the same bucket as a real fault — that is the
    // entire point of the grouping.
    expect(byId.attention).toEqual(["discord"]);
    expect(byId.unknown).toEqual(["provider"]);
    expect(byId.ok).toEqual(["cache"]);
  });

  test("attention comes first, ok last", () => {
    const sections = buildDiagnosticsSections([
      row("cache", "healthy"),
      row("provider", "unknown"),
      row("discord", "blocked"),
    ]);

    expect(sections.map((section) => section.id)).toEqual(["attention", "unknown", "ok"]);
  });

  test("degraded and recoverable are faults, not unknowns", () => {
    const sections = buildDiagnosticsSections([
      row("provider", "degraded"),
      row("network", "recoverable"),
    ]);

    expect(sections.map((section) => section.id)).toEqual(["attention"]);
    expect(sections[0]?.rows).toHaveLength(2);
  });

  test("empty sections are omitted entirely", () => {
    const sections = buildDiagnosticsSections([row("cache", "healthy"), row("memory", "healthy")]);
    expect(sections.map((section) => section.id)).toEqual(["ok"]);
  });

  test("everything healthy still returns a section rather than nothing", () => {
    const sections = buildDiagnosticsSections([row("cache", "healthy")]);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.rows).toHaveLength(1);
  });

  test("no rows yields no sections", () => {
    expect(buildDiagnosticsSections([])).toEqual([]);
  });

  test("row order within a section is preserved", () => {
    const sections = buildDiagnosticsSections([
      row("network", "healthy"),
      row("cache", "healthy"),
      row("memory", "healthy"),
    ]);

    expect(sections[0]?.rows.map((r) => r.subsystem)).toEqual(["network", "cache", "memory"]);
  });

  test("every section carries a human title", () => {
    const sections = buildDiagnosticsSections([
      row("discord", "blocked"),
      row("provider", "unknown"),
      row("cache", "healthy"),
    ]);

    for (const section of sections) {
      expect(section.title.length).toBeGreaterThan(0);
    }
  });
});
