import { describe, expect, test } from "bun:test";

import { hasPrintableGraphicsLeak, posterProtocol } from "../../support/poster-smoke-evidence";

describe("poster smoke evidence", () => {
  test("recognizes wrapped Kitty without mistaking a valid packet for raw text", () => {
    const transcript = "\x1bPtmux;\x1b\x1b_Ga=T,U=1,m=0;AAAA\x1b\x1b\\\x1b\\\u{10EEEE}";
    expect(posterProtocol(transcript)).toBe("kitty-tmux");
    expect(hasPrintableGraphicsLeak(transcript)).toBe(false);
  });

  test("requires actual placement and ignores the Kitty capability query", () => {
    const query = "\x1b_Gi=31,s=1,v=1,a=q;AAAA\x1b\\";
    expect(posterProtocol(query)).toBeNull();
    expect(posterProtocol(query + "\x1b[4;6H\x1b_Ga=p,i=8;\x1b\\")).toBe("kitty-direct");
  });

  test("flags printable escape fragments among otherwise valid ANSI", () => {
    expect(hasPrintableGraphicsLeak("\x1b[31m_Ga=T,U=1,m=0;AAAA\x1b[0m")).toBe(true);
    expect(hasPrintableGraphicsLeak("[0;1;0q\x221;1;16;16#1;2;0;0;0")).toBe(true);
    expect(hasPrintableGraphicsLeak("]1337;File=inline=1:AAAA")).toBe(true);
    expect(hasPrintableGraphicsLeak("Ptmux;")).toBe(true);
    expect(hasPrintableGraphicsLeak("Smoke Movie \x1b[38;2;1;2;3m▀\x1b[0m")).toBe(false);
  });

  test("flags truncated graphics packets even when the introducer is intact", () => {
    expect(hasPrintableGraphicsLeak("\x1b_Ga=T,U=1,m=0;AAAA")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1bPtmux;")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1bP0;1;0q\x221;1;16;16")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1b]1337;File=inline=1:AAAA")).toBe(true);
    expect(hasPrintableGraphicsLeak("\x1b]1337;File=inline=1:AAAA\x07")).toBe(false);
    expect(hasPrintableGraphicsLeak("\x1bP0;1;0q\x221;1;16;16\x1b\\")).toBe(false);
  });
});
