import { describe, expect, test } from "bun:test";

import { classifyProviderResolveUserState } from "@/app/playback/provider-resolve-user-state";
import type { PlaybackProblem } from "@/domain/playback/playback-problem";

function problem(cause: string, severity: PlaybackProblem["severity"] = "recoverable") {
  return {
    stage: "provider-resolve",
    severity,
    cause,
    userMessage: `synthetic ${cause}`,
    recommendedAction: "diagnostics",
    secondaryActions: [],
  } satisfies PlaybackProblem;
}

describe("provider resolve user state", () => {
  test("a healthy resolve reports nothing at all", () => {
    expect(classifyProviderResolveUserState({})).toBeNull();
    expect(classifyProviderResolveUserState({ problem: null })).toBeNull();
  });

  test("advisory copy mentioning fallback never claims a source failed", () => {
    // Regression: the healthy-path note "Recoverable provider failures retry
    // before fallback." used to substring-match `fallback` and render
    // "Trying another source" over a successful resolve.
    expect(
      classifyProviderResolveUserState({
        problem: null,
        fallbackInProgress: false,
        elapsedSeconds: 3,
      }),
    ).toBeNull();
  });

  test("trying another source requires fallback to have actually started", () => {
    expect(classifyProviderResolveUserState({ fallbackInProgress: true })?.title).toBe(
      "Trying another source",
    );
  });

  test("maps structured causes to truthful titles", () => {
    expect(classifyProviderResolveUserState({ problem: problem("network-offline") })?.title).toBe(
      "Network looks unstable",
    );
    expect(classifyProviderResolveUserState({ problem: problem("network") })?.title).toBe(
      "Network looks unstable",
    );
    expect(classifyProviderResolveUserState({ problem: problem("no-stream") })?.title).toBe(
      "No playable source found",
    );
    expect(classifyProviderResolveUserState({ problem: problem("provider-timeout") })?.title).toBe(
      "Slow source",
    );
    expect(classifyProviderResolveUserState({ problem: problem("provider-session") })?.title).toBe(
      "Provider issue for this title",
    );
    expect(classifyProviderResolveUserState({ problem: problem("provider-access") })?.title).toBe(
      "Provider issue for this title",
    );
  });

  test("a cached stream is only reported when the refresh actually failed", () => {
    expect(classifyProviderResolveUserState({ servedFromCacheAfterFailure: true })?.title).toBe(
      "Using cached source",
    );
    expect(classifyProviderResolveUserState({ servedFromCacheAfterFailure: false })).toBeNull();
  });

  test("a long wait is reported as slow without blaming the source for failing", () => {
    const slow = classifyProviderResolveUserState({ elapsedSeconds: 20 });
    expect(slow?.title).toBe("Slow source");
    expect(slow?.detail).not.toContain("did not resolve");
  });

  test("a real problem outranks a merely slow wait", () => {
    expect(
      classifyProviderResolveUserState({
        problem: problem("no-stream", "blocking"),
        elapsedSeconds: 45,
      })?.title,
    ).toBe("No playable source found");
  });
});
