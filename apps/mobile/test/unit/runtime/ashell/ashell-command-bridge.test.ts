import { describe, expect, test } from "bun:test";

import { createAShellCommandBridge } from "../../../../src/runtime/ashell/ashell-command-bridge";
import type { AShellJsc } from "../../../../src/runtime/ashell/ashell-globals";

function fakeJsc(systemCommands: string[]): AShellJsc {
  return {
    readFile: () => "",
    writeFile: () => 0,
    isFile: () => false,
    makeFolder: () => 0,
    deleteFile: () => 0,
    move: () => 0,
    system(command) {
      systemCommands.push(command);
      return 0;
    },
  };
}

describe("a-Shell fixed command bridge", () => {
  test("maps helper names to constant commands", () => {
    const systemCommands: string[] = [];
    const bridge = createAShellCommandBridge(fakeJsc(systemCommands));

    expect(bridge.runFixedHelper("read-line")).toBe(0);
    expect(bridge.runFixedHelper("http")).toBe(0);
    expect(bridge.runFixedHelper("open-vlc")).toBe(0);
    expect(systemCommands).toEqual([
      "./kunai-mobile-read-line",
      "./kunai-mobile-http",
      "./kunai-mobile-open-vlc",
    ]);
  });

  test("normalizes the string status returned by the WebView jsc host", () => {
    const jsc = fakeJsc([]);
    jsc.system = () => "0";

    expect(createAShellCommandBridge(jsc).runFixedHelper("read-line")).toBe(0);
  });

  test("rejects any value outside the literal helper allowlist", () => {
    const systemCommands: string[] = [];
    const bridge = createAShellCommandBridge(fakeJsc(systemCommands));
    const answer = "$(touch /tmp/nope); token=secret";

    expect(() => bridge.runFixedHelper("../../bin/sh" as never)).toThrow("Unsupported helper");
    expect(systemCommands.join(" ")).not.toContain(answer);
    expect(systemCommands).toHaveLength(0);
  });
});
