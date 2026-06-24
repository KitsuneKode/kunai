import { describe, expect, test } from "bun:test";

import { resolveSessionConfigOverrides } from "@/app/session/session-overrides";

describe("resolveSessionConfigOverrides", () => {
  const off = { zenMode: false, minimalMode: false };

  test("-m/--minimal flips minimalMode so the flag matches its name", () => {
    expect(resolveSessionConfigOverrides({ zen: false, minimal: true }, off)).toEqual({
      minimalMode: true,
    });
  });

  test("--zen (implies minimal) flips both zen and minimal layout fields", () => {
    expect(resolveSessionConfigOverrides({ zen: true, minimal: true }, off)).toEqual({
      zenMode: true,
      minimalMode: true,
    });
  });

  test("omits already-enabled fields so no no-op update is issued", () => {
    expect(
      resolveSessionConfigOverrides(
        { zen: true, minimal: true },
        { zenMode: true, minimalMode: true },
      ),
    ).toEqual({});
  });

  test("returns nothing for a default launch", () => {
    expect(resolveSessionConfigOverrides({ zen: false, minimal: false }, off)).toEqual({});
  });
});
