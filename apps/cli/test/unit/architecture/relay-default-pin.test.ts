import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "@kunai/config";

/**
 * Hazard #4: `providerRelay.baseUrl` is empty by default and user-owned.
 * Published npm tarballs and compiled binaries are immutable — a shared relay
 * host baked into one is there forever, and every affected install would
 * route provider metadata through a server the user never chose.
 *
 * Every other `baseUrl: ""` in the test tree is an *input* — this is the only
 * assertion bound to the shipped default itself, so a well-meaning default
 * change fails here even when every consumer test still passes.
 */
describe("providerRelay default pin", () => {
  test("the shipped default baseUrl is empty — no shared relay ever", () => {
    expect(DEFAULT_CONFIG.providerRelay.baseUrl).toBe("");
    expect(DEFAULT_CONFIG.providerRelay.token).toBe("");
  });

  test("an empty baseUrl still means direct fetches only", () => {
    // fallbackToDirect with an empty baseUrl is the "no relay configured"
    // state; the pin above is meaningless if this drifts.
    expect(DEFAULT_CONFIG.providerRelay.fallbackToDirect).toBe(true);
  });
});
