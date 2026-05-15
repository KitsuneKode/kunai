import { describe, expect, test } from "bun:test";

import { createSourceSelectionEngine } from "@/domain/playback-source/SourceSelectionEngine";

describe("SourceSelectionEngine", () => {
  test("keeps offline library actions local-only", () => {
    const result = createSourceSelectionEngine().decide({
      entrypoint: "offline-library",
      local: { status: "ready", jobId: "job-1" },
      networkAvailable: true,
      preference: "prefer-online",
    });

    expect(result.source).toBe("local");
    expect(result.shouldResolveOnline).toBe(false);
    expect(result.reason).toBe("offline-entry");
  });

  test("does not resolve online automatically for broken offline library rows", () => {
    const result = createSourceSelectionEngine().decide({
      entrypoint: "offline-library",
      local: { status: "missing-file", jobId: "job-1" },
      networkAvailable: true,
      preference: "prefer-local",
    });

    expect(result.source).toBe("blocked");
    expect(result.shouldResolveOnline).toBe(false);
    expect(result.actions.map((action) => action.kind)).toEqual(["repair-local", "browse-offline"]);
  });

  test("prefers ready local media for continuation without provider resolve", () => {
    const result = createSourceSelectionEngine().decide({
      entrypoint: "continue",
      local: { status: "ready", jobId: "job-1" },
      networkAvailable: true,
      preference: "ask",
    });

    expect(result.source).toBe("local");
    expect(result.shouldResolveOnline).toBe(false);
    expect(result.actions.map((action) => action.kind)).toEqual(["play-local", "watch-online"]);
  });

  test("does not let offline availability hijack normal online search by default", () => {
    const result = createSourceSelectionEngine().decide({
      entrypoint: "online-search",
      local: { status: "ready", jobId: "job-1" },
      networkAvailable: true,
      preference: "ask",
    });

    expect(result.source).toBe("online");
    expect(result.shouldResolveOnline).toBe(true);
    expect(result.actions.map((action) => action.kind)).toEqual(["watch-online", "play-local"]);
  });

  test("offers repair and online fallback for broken local media", () => {
    const result = createSourceSelectionEngine().decide({
      entrypoint: "continue",
      local: { status: "invalid-file", jobId: "job-1" },
      networkAvailable: true,
      preference: "prefer-local",
    });

    expect(result.source).toBe("online");
    expect(result.shouldResolveOnline).toBe(true);
    expect(result.actions.map((action) => action.kind)).toEqual(["repair-local", "watch-online"]);
  });
});
