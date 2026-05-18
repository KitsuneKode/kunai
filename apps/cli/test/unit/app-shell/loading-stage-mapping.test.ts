import { describe, expect, test } from "bun:test";

import {
  getProviderResolveWaitPresentation,
  getStageAnimationVariant,
  normalizeLoadingIssue,
  renderStageRail,
  resolveStageFromOperation,
  stageDescription,
  stageLabel,
} from "@/app-shell/loading-shell-runtime";

describe("loading shell 4-stage mapping", () => {
  test("maps coarse operations to high-level stages", () => {
    expect(resolveStageFromOperation("resolving")).toBe("finding-stream");
    expect(resolveStageFromOperation("loading")).toBe("preparing-player");
    expect(resolveStageFromOperation("playing")).toBe("starting-playback");
  });

  test("explicit stage overrides operation inference", () => {
    expect(resolveStageFromOperation("resolving", "preparing-player")).toBe("preparing-player");
  });

  test("stage labels are human-readable", () => {
    expect(stageLabel("finding-stream")).toBe("finding stream");
    expect(stageLabel("preparing-provider")).toBe("preparing providers");
    expect(stageLabel("preparing-player")).toBe("preparing player");
    expect(stageLabel("starting-playback")).toBe("starting playback");
  });

  test("stage descriptions explain what each stage does", () => {
    expect(stageDescription("finding-stream")).toContain("Resolving title metadata");
    expect(stageDescription("preparing-provider")).toContain("Selecting provider");
    expect(stageDescription("preparing-player")).toContain("Loading skip timing");
    expect(stageDescription("starting-playback")).toContain("Launching mpv");
  });

  test("stage rail shows all 4 stages with correct tone progression", () => {
    const rail = renderStageRail("preparing-player", null);
    expect(rail).toHaveLength(4);
    expect(rail[0]!.tone).toBe("success"); // finding-stream is past
    expect(rail[1]!.tone).toBe("success"); // preparing-provider is past
    expect(rail[2]!.tone).toBe("info"); // preparing-player is active
    expect(rail[3]!.tone).toBe("neutral"); // starting-playback is future
  });

  test("preparing-provider is visible as the active stage in the rail", () => {
    const rail = renderStageRail("preparing-provider", null);
    expect(rail).toHaveLength(4);
    expect(rail[0]!.tone).toBe("success");
    expect(rail[1]!.label).toBe("Providers");
    expect(rail[1]!.tone).toBe("info");
    expect(rail[1]!.glyph).toMatch(/◓/u);
    expect(rail[2]!.tone).toBe("neutral");
    expect(rail[3]!.tone).toBe("neutral");
  });

  test("stage rail turns active stage amber when latestIssue exists", () => {
    const rail = renderStageRail("preparing-player", "CDN timeout");
    expect(rail[2]!.tone).toBe("warning");
  });

  test("stage rail treats subtitle-ready notes as healthy status, not issues", () => {
    expect(normalizeLoadingIssue("subtitle attached")).toBeNull();
    expect(normalizeLoadingIssue("subs ready")).toBeNull();
    const rail = renderStageRail("preparing-player", "subtitle attached");
    expect(rail[2]!.tone).toBe("info");
  });

  test("stage rail treats provider retry copy as progress, not an issue", () => {
    expect(
      normalizeLoadingIssue("Recoverable provider failures retry before fallback."),
    ).toBeNull();
    const rail = renderStageRail(
      "finding-stream",
      "Recoverable provider failures retry before fallback.",
    );
    expect(rail[0]!.tone).toBe("info");
  });

  test("stage rail turns active stage info when no issue present", () => {
    const rail = renderStageRail("finding-stream", null);
    expect(rail[0]!.tone).toBe("info");
  });

  test("each stage maps to a distinct animation variant", () => {
    expect(getStageAnimationVariant("finding-stream")).toBe("echo-ring");
    expect(getStageAnimationVariant("preparing-provider")).toBe("pulse-grid");
    expect(getStageAnimationVariant("preparing-player")).toBe("neon-drift");
    expect(getStageAnimationVariant("starting-playback")).toBe("core-spiral");
  });
});

describe("provider resolve wait presentation", () => {
  test("returns stageDetail when provided", () => {
    const result = getProviderResolveWaitPresentation({
      elapsedSeconds: 5,
      stageDetail: "Resolving direct link…",
    });
    expect(result.message).toBe("Resolving direct link…");
  });

  test("latestIssue takes priority over elapsed degradation", () => {
    const result = getProviderResolveWaitPresentation({
      elapsedSeconds: 36,
      latestIssue: "vidking: CDN request timed out",
    });
    expect(result.message).toBe("Issue: vidking: CDN request timed out");
    expect(result.tone).toBe("warning");
  });

  test("elapsed >= 20 without issue triggers degradation hint", () => {
    const result = getProviderResolveWaitPresentation({
      elapsedSeconds: 25,
      fallbackAvailable: true,
    });
    expect(result.message).toContain("degraded");
    expect(result.tone).toBe("warning");
    expect(result.footerTask).toContain("fallback");
  });

  test("elapsed 10-19 shows taking-longer hint", () => {
    const result = getProviderResolveWaitPresentation({
      elapsedSeconds: 15,
    });
    expect(result.message).toBe("Taking longer than expected…");
    expect(result.tone).toBe("info");
  });
});
