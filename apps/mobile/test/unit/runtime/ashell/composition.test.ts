import { describe, expect, test } from "bun:test";

import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";
import { exitMobile, mobileArgv, mobileVersion } from "../../../../src/runtime/ashell/composition";

describe("a-Shell mobile composition", () => {
  test("reads exact arguments from private files and erases the transport", () => {
    const argumentsToRead = [
      "--host-proof",
      "--probe-url",
      "https://example.com/'];globalThis.kunaiReviewMarker=123;//",
      "--media-url",
      "https://media.example/a\\b\nnext",
    ];
    const files = new Map<string, string>([
      [".runtime/argv-count", String(argumentsToRead.length)],
      ...argumentsToRead.map((value, index) => [`.runtime/argv-${index}`, value] as const),
    ]);

    expect(
      mobileArgv({
        readFile: (path) => files.get(path) ?? "",
        writeFile: () => 0,
        isFile: (path) => files.has(path),
        makeFolder: () => 0,
        deleteFile(path) {
          files.delete(path);
          return 0;
        },
        move: () => 0,
        system: () => 0,
      } satisfies AShellJsc),
    ).toEqual(argumentsToRead);
    expect([...files.keys()].filter((path) => path.includes("argv"))).toEqual([]);
  });

  test("fails closed and cleans up malformed staged arguments", () => {
    const files = new Map<string, string>([
      [".runtime/argv-count", "33"],
      [".runtime/argv-0", "--help"],
    ]);
    expect(() =>
      mobileArgv({
        readFile: (path) => files.get(path) ?? "",
        writeFile: () => 0,
        isFile: (path) => files.has(path),
        makeFolder: () => 0,
        deleteFile(path) {
          files.delete(path);
          return 0;
        },
        move: () => 0,
        system: () => 0,
      } satisfies AShellJsc),
    ).toThrow("arguments");
    expect([...files.keys()].filter((path) => path.includes("argv"))).toEqual([]);
  });

  test("fails closed when the host reports cleanup success but retains an argument", () => {
    const files = new Map<string, string>([
      [".runtime/argv-count", "1"],
      [".runtime/argv-0", "--help"],
    ]);
    expect(() =>
      mobileArgv({
        readFile: (path) => files.get(path) ?? "",
        writeFile: () => 0,
        isFile: (path) => files.has(path),
        makeFolder: () => 0,
        deleteFile: () => 0,
        move: () => 0,
        system: () => 0,
      } satisfies AShellJsc),
    ).toThrow("arguments");
  });

  test("writes every application exit status for the foreground launcher", () => {
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
      expect(() => exitMobile(1)).not.toThrow();
      expect(files.get(".runtime/exit-code")).toBe("1");
      files.delete(".runtime/exit-code");
      expect(() => exitMobile(2)).not.toThrow();
      expect(files.get(".runtime/exit-code")).toBe("2");
    } finally {
      globalThis.jsc = previousJsc;
    }
  });
});
