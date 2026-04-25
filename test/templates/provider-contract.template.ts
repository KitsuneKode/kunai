// Copy this file when adding a real provider contract test.
// Rename it to `<provider>.contract.test.ts` under `test/providers/`.
//
// Keep provider tests fixture-driven. Live sites should only be used in
// `test/live/` smoke scripts, not in the default test path.

import { describe, expect, test } from "bun:test";

describe("provider contract template", () => {
  test.skip("maps a provider-specific title result into the shared title shape", () => {});
  test.skip("extracts every candidate stream instead of assuming the first source wins", () => {});
  test.skip("preserves subtitle inventory when the provider exposes it", () => {});
  test.skip("records a useful failure reason when no playable stream is found", () => {});

  test("replace this template with a real provider contract test", () => {
    expect(true).toBe(true);
  });
});
