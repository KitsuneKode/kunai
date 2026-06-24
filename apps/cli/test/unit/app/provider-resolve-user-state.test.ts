import { describe, expect, test } from "bun:test";

import { classifyProviderResolveUserState } from "@/app/playback/provider-resolve-user-state";

describe("provider resolve user state", () => {
  test("classifies truthful provider and network outcomes", () => {
    expect(classifyProviderResolveUserState({ issue: "Network looks unstable" })?.title).toBe(
      "Network looks unstable",
    );
    expect(classifyProviderResolveUserState({ issue: "No source available" })?.title).toBe(
      "No playable source found",
    );
    expect(
      classifyProviderResolveUserState({ issue: "VidKing had an issue. Trying fallback now." })
        ?.title,
    ).toBe("Trying another source");
    expect(classifyProviderResolveUserState({ issue: "Using cached source" })?.title).toBe(
      "Using cached source",
    );
  });

  test("uses slow source instead of a vague degradation label after a long wait", () => {
    expect(classifyProviderResolveUserState({ elapsedSeconds: 20 })?.title).toBe("Slow source");
    expect(classifyProviderResolveUserState({ issue: "Provider/CDN may be degraded" })?.title).toBe(
      "Slow source",
    );
  });
});
