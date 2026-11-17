// Frame captures for every setup screen, at the three canonical widths.
//
// A layout break in a terminal UI is invisible in a source diff and obvious in
// a rendered one, so these are committed. Each screen is reached by driving the
// real shell with Enter, rather than by rendering screens in isolation — that
// way the captures exercise the same frame, footer, and step chrome a user sees.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ROOT_HORIZONTAL_PADDING } from "@/app-shell/layout-policy";
import { AppHeader } from "@/app-shell/primitives/AppHeader";
import { SetupShell } from "@/app-shell/setup-shell";
import { TransientRowSlot } from "@/app-shell/shell-primitives";
import type { CapabilitySnapshot } from "@/ui";
import { Box } from "ink";
import React from "react";

import { CAPTURE_WIDTHS, render, stripAnsi, type CaptureWidth } from "./render-capture";

const CAPTURE_DIR = path.join(import.meta.dir, "..", "__captures__");
export const SETUP_ROWS = 34;

const READY: CapabilitySnapshot = {
  mpv: true,
  mpvRequired: true,
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

export const SETUP_SCREENS = ["deps", "mode", "language", "library", "analytics", "done"] as const;

function withPinnedProcessPlatform<T>(run: () => T): T {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "arch", { value: "x64" });
  try {
    return run();
  } finally {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
    if (archDescriptor) Object.defineProperty(process, "arch", archDescriptor);
  }
}

function driveSetupFrame(
  step: number,
  columns: number,
  rows: number,
  tree: React.ReactElement,
  extraKeys = "",
): string {
  return withPinnedProcessPlatform(() => {
    const handle = render(tree, { columns, rows });
    for (let i = 0; i < step; i += 1) handle.stdin.enqueue("\r");
    for (const char of extraKeys) handle.stdin.enqueue(char);
    const frame = stripAnsi(handle.lastFrame()).replace(/\s+$/, "");
    handle.unmount();
    return frame;
  });
}

/** Same layout budget as `AppRoot`: header, transient row, then the wizard. */
export function setupFrameWithAppChromeAt(
  step: number,
  columns: number,
  rows: number,
  extraKeys = "",
): string {
  const innerWidth = Math.max(0, columns - ROOT_HORIZONTAL_PADDING * 2);
  return driveSetupFrame(
    step,
    columns,
    rows,
    <Box width={columns} height={rows} flexDirection="column" paddingX={ROOT_HORIZONTAL_PADDING}>
      <AppHeader destination="Setup" width={innerWidth} />
      <TransientRowSlot width={Math.max(36, columns - 8)} />
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        <SetupShell snapshot={READY} finish={() => {}} downloadPath="~/.local/share/kunai" />
      </Box>
    </Box>,
    extraKeys,
  );
}

export function setupFrameAt(step: number, columns: number, rows = SETUP_ROWS): string {
  // The analytics consent screen prints this machine's `process.platform` and
  // `process.arch` into the payload preview — true at runtime, but it makes a
  // committed capture host-dependent. Pin a canonical pair for the render so a
  // capture written on linux/x64 verifies byte-for-byte on a macOS runner.
  return driveSetupFrame(
    step,
    columns,
    rows,
    <Box width={columns} paddingX={1} flexDirection="column">
      <SetupShell snapshot={READY} finish={() => {}} downloadPath="~/.local/share/kunai" />
    </Box>,
  );
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
