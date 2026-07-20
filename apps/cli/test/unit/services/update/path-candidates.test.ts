import { describe, expect, test } from "bun:test";

import { findKunaiPathCandidates } from "@/services/update/path-candidates";

describe("findKunaiPathCandidates", () => {
  test("preserves POSIX PATH order", () => {
    const existing = new Set(["/opt/npm/bin/kunai", "/home/k/.local/bin/kunai"]);

    expect(
      findKunaiPathCandidates({
        pathValue: "/opt/npm/bin:/home/k/.local/bin",
        platform: "linux",
        fileExists: (path) => existing.has(path),
      }).map((item) => item.path),
    ).toEqual(["/opt/npm/bin/kunai", "/home/k/.local/bin/kunai"]);
  });

  test("uses Windows PATHEXT order", () => {
    const existing = new Set([
      "C:\\Users\\k\\AppData\\Roaming\\npm\\kunai.cmd",
      "C:\\Users\\k\\AppData\\Local\\kunai\\bin\\kunai.exe",
    ]);

    expect(
      findKunaiPathCandidates({
        pathValue: "C:\\Users\\k\\AppData\\Roaming\\npm;C:\\Users\\k\\AppData\\Local\\kunai\\bin",
        pathExt: ".COM;.EXE;.BAT;.CMD",
        platform: "win32",
        fileExists: (path) => existing.has(path),
      }).map((item) => item.path),
    ).toEqual([...existing]);
  });

  test("ignores empty Windows PATH entries and deduplicates case-insensitively", () => {
    const directory = "C:\\Users\\k\\AppData\\Roaming\\npm";

    expect(
      findKunaiPathCandidates({
        pathValue: `;${directory};${directory.toUpperCase()};`,
        pathExt: ".CMD",
        platform: "win32",
        fileExists: (path) => path.toLowerCase() === `${directory}\\kunai.cmd`.toLowerCase(),
      }),
    ).toEqual([
      {
        path: `${directory}\\kunai.cmd`,
        directory,
        rank: 0,
        extension: ".cmd",
      },
    ]);
  });

  test("deduplicates case-equivalent Windows PATHEXT candidates", () => {
    expect(
      findKunaiPathCandidates({
        pathValue: "C:\\Users\\k\\AppData\\Roaming\\npm",
        pathExt: ".CMD;.cmd",
        platform: "win32",
        fileExists: (path) => path.toLowerCase().endsWith("\\kunai.cmd"),
      }),
    ).toHaveLength(1);
  });
});
