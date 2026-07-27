import { describe, expect, test } from "bun:test";

import { buildPtyCommand } from "../../helpers/pty-command";

describe("PTY command", () => {
  test("uses util-linux script syntax on Linux", () => {
    expect(buildPtyCommand("exec bun cli.ts", "/tmp/cli.log", "linux")).toEqual([
      "script",
      "-qec",
      "exec bun cli.ts",
      "/tmp/cli.log",
    ]);
  });

  test("uses BSD script syntax on macOS", () => {
    expect(buildPtyCommand("exec bun cli.ts", "/tmp/cli.log", "darwin")).toEqual([
      "script",
      "-qe",
      "/tmp/cli.log",
      "/bin/sh",
      "-c",
      "exec bun cli.ts",
    ]);
  });
});
