import { describe, expect, test } from "bun:test";

import { exitMobile, mobileArgv, mobileVersion } from "../../../../src/runtime/ashell/composition";

describe("a-Shell mobile composition", () => {
  test("reads only the documented process argv shape", () => {
    expect(mobileArgv({ argv: ["jsc", "kunai-mobile.js", "--help"] })).toEqual(["--help"]);
    expect(() => mobileArgv({ argv: "--help" })).toThrow("argv");
  });

  test("uses the development version fallback and fixed exit behavior", () => {
    expect(mobileVersion()).toBe("0.0.0-dev");
    expect(() => exitMobile(0)).not.toThrow();
    expect(() => exitMobile(1)).toThrow("Mobile host proof failed");
  });
});
