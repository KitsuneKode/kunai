import { describe, expect, test } from "bun:test";

import { buildDarwinExpectScript, buildPtyCommand } from "../../helpers/pty-command";

describe("PTY command", () => {
  test("uses util-linux script syntax on Linux", () => {
    expect(buildPtyCommand("exec bun cli.ts", "/tmp/cli.log", "linux")).toEqual([
      "script",
      "-qec",
      "exec bun cli.ts",
      "/tmp/cli.log",
    ]);
  });

  test("uses expect on macOS so BSD script never probes a non-TTY stdin", () => {
    const argv = buildPtyCommand("exec bun cli.ts", "/tmp/cli.log", "darwin");
    expect(argv[0]).toBe("expect");
    expect(argv[1]).toBe("-c");
    expect(argv[2]).toBe(buildDarwinExpectScript("exec bun cli.ts", "/tmp/cli.log"));
    expect(argv[2]).toContain('spawn /bin/sh -c "exec bun cli.ts"');
    expect(argv[2]).toContain('log_file "/tmp/cli.log"');
    expect(argv[2]).toContain("CHILDKILLED");
    expect(argv[2]).toContain("SIGINT { exit 130 }");
  });

  test("Tcl-escapes dollar signs and brackets in the macOS expect script", () => {
    const script = buildDarwinExpectScript(
      'echo $$ > /tmp/pid; exec env FOO="[x]" bun',
      "/tmp/a.log",
    );
    expect(script).toContain("echo \\$\\$ > /tmp/pid");
    expect(script).toContain('FOO=\\"\\[x\\]\\"');
  });
});
