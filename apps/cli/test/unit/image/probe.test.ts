import { describe, expect, test } from "bun:test";

import { canProbeTerminal, parseDeviceAttributes } from "@/image/probe";

const ESC = "\x1b";

describe("parseDeviceAttributes", () => {
  // Attribute 4 in a DA1 reply is sixel. This is the single fact the probe
  // exists to learn: env vars cannot express it, so Windows Terminal >=1.22
  // and every unrecognised sixel terminal were given half-block instead.
  test("reads sixel support from attribute 4", () => {
    expect(parseDeviceAttributes(`${ESC}[?62;4;6;22c`).sixel).toBe(true);
    expect(parseDeviceAttributes(`${ESC}[?4c`).sixel).toBe(true);
    expect(parseDeviceAttributes(`${ESC}[?62;1;6;22c`).sixel).toBe(false);
  });

  // A substring test would accept 14, 40 or 44 as "sixel" and start emitting
  // escape bytes to a terminal that cannot render them.
  test("does not mistake 14, 40 or 44 for 4", () => {
    expect(parseDeviceAttributes(`${ESC}[?62;14;40;44c`).sixel).toBe(false);
    expect(parseDeviceAttributes(`${ESC}[?64;14c`).sixel).toBe(false);
  });

  test("reads kitty graphics from a ;OK or error response", () => {
    expect(parseDeviceAttributes(`${ESC}_Gi=31;OK${ESC}\\${ESC}[?62c`).kittyGraphics).toBe(true);
    // An error reply still proves the protocol is understood.
    expect(parseDeviceAttributes(`${ESC}_Gi=31;EBADF${ESC}\\${ESC}[?62c`).kittyGraphics).toBe(true);
    expect(parseDeviceAttributes(`${ESC}[?62;4c`).kittyGraphics).toBe(false);
  });

  test("treats malformed and empty replies as no support", () => {
    for (const reply of ["", "garbage", `${ESC}[?`, `${ESC}[c`, "4"]) {
      expect(parseDeviceAttributes(reply)).toEqual({ sixel: false, kittyGraphics: false });
    }
  });

  // Replies arrive split across reads; the probe accumulates before parsing,
  // so the parser must read a concatenated buffer correctly.
  test("reads a reply reassembled from several chunks", () => {
    const chunks = [`${ESC}_Gi=31;OK${ESC}\\`, `${ESC}[?62;`, "4;6c"];
    expect(parseDeviceAttributes(chunks.join(""))).toEqual({ sixel: true, kittyGraphics: true });
  });
});

describe("canProbeTerminal", () => {
  const tty = { isTTY: true };

  test("probes only an interactive terminal", () => {
    expect(canProbeTerminal({ TERM: "xterm" }, tty, tty)).toBe(true);
    // Piping: writing a query here would dump escape bytes into the pipe.
    expect(canProbeTerminal({ TERM: "xterm" }, { isTTY: false }, tty)).toBe(false);
    expect(canProbeTerminal({ TERM: "xterm" }, tty, { isTTY: false })).toBe(false);
  });

  test("refuses CI, dumb terminals, and an explicit opt-out", () => {
    expect(canProbeTerminal({ TERM: "xterm", CI: "1" }, tty, tty)).toBe(false);
    expect(canProbeTerminal({ TERM: "dumb" }, tty, tty)).toBe(false);
    expect(canProbeTerminal({}, tty, tty)).toBe(false);
    expect(canProbeTerminal({ TERM: "xterm", KUNAI_IMAGE_PROBE: "0" }, tty, tty)).toBe(false);
    expect(canProbeTerminal({ TERM: "xterm", KUNAI_IMAGE_PROBE: "false" }, tty, tty)).toBe(false);
  });
});
