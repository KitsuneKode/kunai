import { describe, expect, test } from "bun:test";

import { isPosixHost } from "../../support/platform-gates";

describe("mobile test platform gates", () => {
  test("keeps POSIX launcher mechanics out of Windows host tests", () => {
    expect(isPosixHost("linux")).toBe(true);
    expect(isPosixHost("darwin")).toBe(true);
    expect(isPosixHost("win32")).toBe(false);
  });
});
