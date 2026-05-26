import { describe, expect, test } from "bun:test";

import {
  DIAGNOSTIC_OPERATION_CATALOG,
  getDiagnosticOperation,
  isKnownDiagnosticOperation,
} from "@/services/diagnostics/operation-taxonomy";

describe("diagnostic operation taxonomy", () => {
  test("keeps high-value runtime operations named and user-actionable", () => {
    expect(isKnownDiagnosticOperation("download.artifact.validated")).toBe(true);
    expect(isKnownDiagnosticOperation("download.artifact.repairable")).toBe(true);
    expect(isKnownDiagnosticOperation("source-inventory.cache.hit")).toBe(true);
    expect(isKnownDiagnosticOperation("post-playback.recommendations.seed")).toBe(true);
    expect(isKnownDiagnosticOperation("post-playback.autonext.prefetch-wait")).toBe(true);
    expect(isKnownDiagnosticOperation("playback.prefetch-wait")).toBe(true);
    expect(isKnownDiagnosticOperation("playback.stream.reused")).toBe(true);
    expect(isKnownDiagnosticOperation("playback.startup.timeline")).toBe(true);
    expect(isKnownDiagnosticOperation("provider.resolve.attempt")).toBe(true);
    expect(isKnownDiagnosticOperation("provider.resolve.fallback")).toBe(true);
    expect(isKnownDiagnosticOperation("provider.selection.decision")).toBe(true);
    expect(isKnownDiagnosticOperation("subtitle.attach.outcome")).toBe(true);
    expect(isKnownDiagnosticOperation("presence.clear.failed")).toBe(true);
    expect(isKnownDiagnosticOperation("resolve.refetch.failed.cached-fallback")).toBe(true);
    expect(isKnownDiagnosticOperation("made.up.operation")).toBe(false);

    expect(getDiagnosticOperation("download.artifact.validated")).toMatchObject({
      category: "download",
      audience: "both",
      userAction: "Open /downloads or /library if the artifact later disappears.",
    });
    expect(getDiagnosticOperation("provider.selection.decision")).toMatchObject({
      category: "provider",
      userAction:
        "Switch startup preference or source manually if a different tradeoff is preferred.",
    });
  });

  test("does not duplicate operation names across categories", () => {
    const names = DIAGNOSTIC_OPERATION_CATALOG.map((entry) => entry.operation);
    expect(new Set(names).size).toBe(names.length);
  });
});
