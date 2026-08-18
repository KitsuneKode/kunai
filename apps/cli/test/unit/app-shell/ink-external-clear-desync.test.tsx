import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import { Box, render, Text } from "ink";
import React from "react";

// Ink owns the screen buffer. It erases the previous frame by walking UP from
// where it believes the cursor is — bottom of the last frame — using one
// erase-line per remembered row. Any write that moves the cursor without Ink
// knowing invalidates that belief, and the erase then lands somewhere else
// entirely.
//
// `clearRootContentTransitionFrame()` does exactly that on every root-content
// transition (playback → post-play among them): a raw `ESC[2J ESC[H` straight
// to stdout. This test pins the consequence so the coupling is visible in CI
// rather than rediscovered from a screenshot. See .docs/debugging-map.md.

class RecordingStdout extends EventEmitter {
  readonly isTTY = true;
  readonly columns = 40;
  readonly rows = 30;
  written: string[] = [];
  write(data: string) {
    this.written.push(data);
    return true;
  }
}

const ESC = String.fromCharCode(0x1b);
const CLEAR_SCREEN = `${ESC}[2J`;
const HOME = `${ESC}[H`;

const Frame = ({ rows }: { readonly rows: number }) => (
  <Box flexDirection="column">
    {Array.from({ length: rows }, (_, index) => (
      // eslint-disable-next-line react/no-array-index-key -- fixed-length probe
      <Text key={index}>{`row-${index}`}</Text>
    ))}
  </Box>
);

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

async function renderThenExternallyClear(): Promise<string> {
  const stdout = new RecordingStdout();
  const instance = render(<Frame rows={12} />, {
    stdout: stdout as never,
    patchConsole: false,
    exitOnCtrlC: false,
    alternateScreen: true,
    // Ink auto-detects CI and, when non-interactive, "disables ANSI erase
    // sequences, cursor manipulation ... writing only the final frame at
    // unmount" — which is the exact behaviour under test. Force the mode a
    // real terminal gets so this measures the shell's write path, not the
    // runner's environment.
    interactive: true,
  });
  try {
    await Bun.sleep(80);
    stdout.written = [];
    // What the transition helper writes today, outside Ink's knowledge.
    stdout.write(`${CLEAR_SCREEN}${HOME}`);
    instance.rerender(<Frame rows={3} />);
    await Bun.sleep(120);
    return stdout.written.join("");
  } finally {
    instance.unmount();
  }
}

describe("external screen clear vs Ink's erase bookkeeping", () => {
  it("still aims a full 12-row erase at a cursor the clear already moved home", async () => {
    const output = await renderThenExternallyClear();

    // Ink erases the frame it remembers (12 rows), not the blank screen that
    // actually exists: one erase-line per remembered row plus the closing one.
    expect(countOf(output, `${ESC}[2K`)).toBe(13);
    // Every cursor-up here is clamped at row 1, because the raw HOME already
    // parked the cursor there — so all 13 erases collapse onto a single row.
    expect(countOf(output, `${ESC}[1A`)).toBe(12);

    // The new, shorter frame is what should be on screen afterwards.
    expect(output).toContain("row-0");
    expect(output).toContain("row-2");
    expect(output).not.toContain("row-3");
  });
});
