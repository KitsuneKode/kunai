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

import { CAPTURE_WIDTHS, render, stripAnsi, type CaptureWidth } from "./render-capture";

const CAPTURE_DIR = path.join(import.meta.dir, "..", "__captures__");
export const SETUP_ROWS = 34;

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

export const SETUP_SCREENS = [
  "deps",
  "mode",
  "language",
  "playback",
  "library",
  "analytics",
  "done",
] as const;

export function setupFrameAt(step: number, columns: number): string {
  // The analytics consent screen prints this machine's `process.platform` and
  // `process.arch` into the payload preview — true at runtime, but it makes a
  // committed capture host-dependent. Pin a canonical pair for the render so a
  // capture written on linux/x64 verifies byte-for-byte on a macOS runner.
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
  try {
    const handle = render(
      <SetupShell snapshot={READY} finish={() => {}} downloadPath="~/.local/share/kunai" />,
      { columns, rows: SETUP_ROWS },
    );
    for (let i = 0; i < step; i += 1) handle.stdin.enqueue("\r");
    const frame = stripAnsi(handle.lastFrame()).replace(/\s+$/, "");
    handle.unmount();
    return frame;
  } finally {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    if (archDescriptor) Object.defineProperty(process, "arch", archDescriptor);
  }
}

if (import.meta.main) {
  await mkdir(CAPTURE_DIR, { recursive: true });
  for (const [index, name] of SETUP_SCREENS.entries()) {
    for (const width of Object.keys(CAPTURE_WIDTHS) as CaptureWidth[]) {
      const columns = CAPTURE_WIDTHS[width];
      const surface = `setup-${index + 1}-${name}`;
      const header = `# ${surface} · ${width} (${columns}×${SETUP_ROWS})\n`;
      await writeFile(
        path.join(CAPTURE_DIR, `${surface}.${width}.txt`),
        `${header}${setupFrameAt(index, columns)}\n`,
        "utf8",
      );
    }
  }

  console.log(`captured ${SETUP_SCREENS.length} setup screens at 3 widths`);
  process.exit(0);
}
