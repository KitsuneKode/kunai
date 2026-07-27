import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { canProbeTerminal, parseDeviceAttributes, probeTerminalGraphics } from "@/image/probe";

/** Minimal stdin stand-in that can be fed a reply and records raw-mode changes. */
class FakeStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  rawModeCalls: boolean[] = [];
  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawModeCalls.push(value);
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
}

function fakeStdout(): { isTTY: boolean; written: string[]; write(chunk: string): boolean } {
  const written: string[] = [];
  return {
    isTTY: true,
    written,
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
  };
}

describe("parseDeviceAttributes", () => {
  test("reads sixel from a Windows Terminal 1.22+ style DA1 reply", () => {
    // WT advertises sixel as attribute 4 in the DA1 parameter list.
    expect(parseDeviceAttributes("[?61;4;6;7;14;21;22;23;24;28;32;42c")).toEqual({
      sixel: true,
      kittyGraphics: false,
    });
  });

  test("does not mistake 14 or 40 for the sixel attribute 4", () => {
    expect(parseDeviceAttributes("[?62;14;40c").sixel).toBe(false);
  });
});

describe("canProbeTerminal on Windows", () => {
  // TERM is a Unix convention that neither Windows Terminal nor PowerShell sets,
  // so requiring it is what kept the probe from ever running on Windows.
  test("probes a Windows console that sets no TERM", () => {
    expect(
      canProbeTerminal({ OS: "Windows_NT", WT_SESSION: "abc" }, { isTTY: true }, { isTTY: true }),
    ).toBe(true);
  });

  test("still refuses when stdout is redirected", () => {
    expect(
      canProbeTerminal({ OS: "Windows_NT", WT_SESSION: "abc" }, { isTTY: true }, { isTTY: false }),
    ).toBe(false);
  });
});

describe("probeTerminalGraphics", () => {
  test("resolves sixel support from a reply that arrives after a delay", async () => {
    const stdin = new FakeStdin();
    const stdout = fakeStdout();

    const pending = probeTerminalGraphics({
      timeoutMs: 1000,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      env: { OS: "Windows_NT", WT_SESSION: "abc" },
    });

    // A Windows console round-trips through conhost; the reply is not immediate.
    setTimeout(() => stdin.emit("data", Buffer.from("[?61;4;6;22c", "latin1")), 150);

    expect(await pending).toEqual({ sixel: true, kittyGraphics: false });
    // The query must actually have been written, and raw mode restored after.
    expect(stdout.written.join("")).toContain("[c");
    expect(stdin.rawModeCalls.at(-1)).toBe(false);
  });

  test("gives up without stranding the terminal in raw mode", async () => {
    const stdin = new FakeStdin();
    const stdout = fakeStdout();

    const result = await probeTerminalGraphics({
      timeoutMs: 30,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      env: { OS: "Windows_NT", WT_SESSION: "abc" },
    });

    expect(result).toBeNull();
    expect(stdin.isRaw).toBe(false);
  });
});
