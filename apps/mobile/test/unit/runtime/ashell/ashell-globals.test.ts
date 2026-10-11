import { describe, expect, test } from "bun:test";

import { requireAShellJsc } from "../../../../src/runtime/ashell/ashell-globals";

describe("a-Shell jsc globals", () => {
  test("accepts the file deletion name exposed by the real a-Shell host", () => {
    const host = {
      readFile: () => "",
      writeFile: () => 0,
      isFile: () => false,
      makeFolder: () => 0,
      delete: () => 0,
      move: () => 0,
      system: () => 0,
    };

    expect(requireAShellJsc(host)).toBe(host);
  });
});
