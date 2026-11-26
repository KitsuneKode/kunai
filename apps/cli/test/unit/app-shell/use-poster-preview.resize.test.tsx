import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __testing as paneTesting } from "@/app-shell/image-pane";
import { setPosterDiskCacheDir } from "@/app-shell/poster-disk-cache";
import { __testing as rendererTesting } from "@/app-shell/poster-renderer";
import { usePosterPreview } from "@/app-shell/use-poster-preview";
import { useShellDimensions } from "@/app-shell/use-viewport-policy";
import type { ImageCapability } from "@/image";
import { setTerminalCellPixels } from "@/image/cell-size";
import { Text } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

const originalPaneDetect = paneTesting.runtime.detectImageCapability;
const originalRendererDetect = rendererTesting.runtime.detectImageCapability;
let outputSpy: ReturnType<typeof spyOn<typeof process.stdout, "write">> | undefined;

function kittyCapability(): ImageCapability {
  return {
    terminal: "kitty",
    protocol: "kitty",
    renderer: "kitty-native",
    available: true,
    reason: "test kitty",
  };
}

function PosterResizeProbe() {
  const { cols } = useShellDimensions();
  const posterCols = cols >= 100 ? 16 : 12;
  usePosterPreview("/resize-poster.jpg", {
    rows: 6,
    cols: posterCols,
    debounceMs: 5_000,
    allowKitty: true,
  });
  return <Text>{`poster-cols=${posterCols}`}</Text>;
}

const tempDirs: string[] = [];

beforeEach(() => {
  // SAFETY: isolated tmp dir — the poster pipeline must not touch the live profile in tests.
  const dir = mkdtempSync(join(tmpdir(), "kunai-poster-resize-"));
  tempDirs.push(dir);
  setPosterDiskCacheDir(dir);
});

afterEach(() => {
  setPosterDiskCacheDir(null);
  paneTesting.runtime.detectImageCapability = originalPaneDetect;
  rendererTesting.runtime.detectImageCapability = originalRendererDetect;
  setTerminalCellPixels(null);
  outputSpy?.mockRestore();
  outputSpy = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("usePosterPreview resize cleanup", () => {
  test("removes stale placements when the cell pixel size changes at a fixed grid", () => {
    paneTesting.runtime.detectImageCapability = kittyCapability;
    rendererTesting.runtime.detectImageCapability = kittyCapability;
    const writes: string[] = [];
    outputSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const handle = render(<PosterResizeProbe />, { columns: 80, rows: 30 });
    try {
      act(() => setTerminalCellPixels({ width: 9, height: 22 }));
      expect(handle.lastFrame()).toContain("poster-cols=12");
      expect(writes).toContain("\x1b_Ga=d,d=A;\x1b\\");
    } finally {
      handle.unmount();
    }
  });

  test("clears terminal image placements immediately when poster dimensions change", () => {
    paneTesting.runtime.detectImageCapability = kittyCapability;
    rendererTesting.runtime.detectImageCapability = kittyCapability;
    const writes: string[] = [];
    outputSpy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    const handle = render(<PosterResizeProbe />, { columns: 80, rows: 30 });
    try {
      expect(handle.lastFrame()).toContain("poster-cols=12");
      writes.length = 0;

      act(() => {
        handle.stdout.columns = 120;
        handle.stdout.emit("resize");
      });

      expect(handle.lastFrame()).toContain("poster-cols=16");
      expect(writes.join("")).toContain("\x1b_Ga=d,d=A;");
    } finally {
      handle.unmount();
    }
  });
});
