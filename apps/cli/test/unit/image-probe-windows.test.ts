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

function fakeStdout() {
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
  test("asks tmux for DA1 directly when passthrough is off", async () => {
    const stdin = new FakeStdin();
    const stdout = {
      isTTY: true,
      write(chunk: string) {
        expect(chunk).toBe("\x1b[c");
        stdin.emit("data", "\x1b[?1;2;4c");
      },
    };
    const tmux = { major: 3, minor: 4, passthrough: "off", clientTerm: "foot" };
    expect(
      await probeTerminalGraphics({
        stdin,
        stdout,
        env: { TERM: "tmux-256color", TMUX: "/tmp/posters,123,0" },
        tmux,
      }),
    ).toMatchObject({ sixel: true, kittyGraphics: false, tmux });
    expect(stdin.rawModeCalls).toEqual([true, false]);
  });

  test("waits for the wrapped Kitty reply after tmux answers DA1", async () => {
    const stdin = new FakeStdin();
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
        stdin.emit("data", "\x1b[?1;2c");
        stdin.emit("data", "\x1b_Gi=31,e=T,");
        stdin.emit("data", "U=1;OK\x1b\\");
        return true;
      },
    };
    const tmux = { major: 3, minor: 3, passthrough: "on", clientTerm: "custom" };
    expect(
      await probeTerminalGraphics({
        stdin,
        stdout,
        env: { TERM: "tmux-256color", TMUX: "/tmp/posters,123,0" },
        tmux,
      }),
    ).toEqual({ sixel: false, kittyGraphics: true, kittyPlaceholders: true, tmux });
    expect(writes).toEqual(["\x1bPtmux;\x1b\x1b_Ga=q,i=31,e=T,U=1\x1b\x1b\\\x1b\\\x1b[c"]);
    expect(stdin.rawModeCalls).toEqual([true, false]);
  });

  test("resolves sixel support from a reply that arrives after a delay", async () => {
    const stdin = new FakeStdin();
    const stdout = fakeStdout();

    const pending = probeTerminalGraphics({
      timeoutMs: 1000,
      stdin,
      stdout,
      env: { OS: "Windows_NT", WT_SESSION: "abc" },
    });

    // The probe is already waiting on stdin. Deliver the reply on the next turn.
    setImmediate(() => stdin.emit("data", Buffer.from("[?61;4;6;22c", "latin1")));

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
      stdin,
      stdout,
      env: { OS: "Windows_NT", WT_SESSION: "abc" },
    });

    expect(result).toBeNull();
    expect(stdin.isRaw).toBe(false);
  });
});
