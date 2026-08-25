// Frame captures for every setup screen, at the three canonical widths.
//
// A layout break in a terminal UI is invisible in a source diff and obvious in
// a rendered one, so these are committed. Each screen is reached by driving the
// real shell with Enter, rather than by rendering screens in isolation — that
// way the captures exercise the same frame, footer, and step chrome a user sees.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { SetupShell } from "@/app-shell/setup-shell";
import type { CapabilitySnapshot } from "@/ui";
import React from "react";

import { CAPTURE_WIDTHS, render, type CaptureWidth } from "./render-capture";

const CAPTURE_DIR = path.join(import.meta.dir, "..", "__captures__");
const ROWS = 34;

const READY: CapabilitySnapshot = {
  mpv: true,
  ffprobe: true,
  ytDlp: true,
  curl: { present: true, impersonates: true, profile: "chrome150" },
  image: {
    terminal: "ghostty",
    protocol: "kitty",
    renderer: "kitty-native",
    available: true,
    reason: "capture fixture",
  },
  issues: [],
};

const SCREENS = ["deps", "mode", "language", "playback", "library", "analytics", "done"] as const;

function frameAt(step: number, columns: number): string {
  const handle = render(
    <SetupShell snapshot={READY} finish={() => {}} downloadPath="~/.local/share/kunai" />,
    { columns, rows: ROWS },
  );
  for (let i = 0; i < step; i += 1) handle.stdin.enqueue("\r");
  const frame = handle.lastFrame();
  handle.unmount();
  return frame;
}

await mkdir(CAPTURE_DIR, { recursive: true });
for (const [index, name] of SCREENS.entries()) {
  for (const width of Object.keys(CAPTURE_WIDTHS) as CaptureWidth[]) {
    const columns = CAPTURE_WIDTHS[width];
    const surface = `setup-${index + 1}-${name}`;
    const header = `# ${surface} · ${width} (${columns}×${ROWS})\n`;
    await writeFile(
      path.join(CAPTURE_DIR, `${surface}.${width}.txt`),
      `${header}${frameAt(index, columns)}\n`,
      "utf8",
    );
  }
}

console.log(`captured ${SCREENS.length} setup screens at 3 widths`);
process.exit(0);
