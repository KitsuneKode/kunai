import { describe, expect, test } from "bun:test";

import { exitMobile, mobileArgv, mobileVersion } from "../../../../src/runtime/ashell/composition";

describe("a-Shell mobile composition", () => {
  test("reads only the documented process argv shape", () => {
    expect(mobileArgv({ argv: ["jsc", "kunai-mobile.js", "--help"] })).toEqual(["--help"]);
    expect(() => mobileArgv({ argv: "--help" })).toThrow("argv");
  });

  test("writes a private status for the launcher and throws only on failure", () => {
    const files = new Map<string, string>();
    const previousJsc = globalThis.jsc;
    globalThis.jsc = {
      readFile: (path) => files.get(path) ?? "",
      writeFile(path, value) {
        files.set(path, value);
        return 0;
      },
      isFile: (path) => files.has(path),
      makeFolder: () => 0,
      deleteFile(path) {
        files.delete(path);
        return 0;
      },
      move: () => 0,
      system: () => 0,
    };
    try {
      expect(mobileVersion()).toBe("0.0.0-dev");
      expect(() => exitMobile(0)).not.toThrow();
      expect(files.get(".runtime/exit-code")).toBe("0");
      expect(() => exitMobile(1)).toThrow("Mobile host proof failed");
      expect(files.get(".runtime/exit-code")).toBe("1");
    } finally {
      globalThis.jsc = previousJsc;
    }
  });
});
