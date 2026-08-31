import { describe, expect, test } from "bun:test";

import { exitMobile, mobileArgv, mobileVersion } from "../../../../src/runtime/ashell/composition";

describe("a-Shell mobile composition", () => {
  test("reads only the documented process argv shape", () => {
    expect(mobileArgv({ argv: ["jsc", "kunai-mobile.js", "--help"] })).toEqual(["--help"]);
    expect(() => mobileArgv({ argv: "--help" })).toThrow("argv");
  });

  test("writes a private status for the launcher and throws only on failure", () => {
    const files = new Map<string, string>();
    const writes: string[] = [];
    const moves: [string, string][] = [];
    const previousJsc = globalThis.jsc;
    globalThis.jsc = {
      readFile: (path) => files.get(path) ?? "",
      writeFile(path, value) {
        writes.push(path);
        files.set(path, value);
        return 0;
      },
      isFile: (path) => files.has(path),
      makeFolder: () => 0,
      deleteFile(path) {
        files.delete(path);
        return 0;
      },
      move(from, to) {
        moves.push([from, to]);
        const value = files.get(from);
        if (value === undefined || files.has(to)) return 1;
        files.delete(from);
        files.set(to, value);
        return 0;
      },
      system: () => 0,
    };
    try {
      expect(mobileVersion()).toBe("0.0.0-dev");
      expect(() => exitMobile(0)).not.toThrow();
      expect(files.get(".runtime/exit-code")).toBe("0");
      expect(writes).toEqual([".runtime/exit-code.tmp"]);
      expect(moves).toEqual([[".runtime/exit-code.tmp", ".runtime/exit-code"]]);
      files.delete(".runtime/exit-code");
      expect(() => exitMobile(1)).toThrow("Mobile host proof failed");
      expect(files.get(".runtime/exit-code")).toBe("1");
    } finally {
      globalThis.jsc = previousJsc;
    }
  });
});
