import { afterEach, describe, expect, test } from "bun:test";

import { __testing as paneTesting } from "@/app-shell/image-pane";
import { __testing as rendererTesting } from "@/app-shell/poster-renderer";
import { usePosterPreview } from "@/app-shell/use-poster-preview";
import { useShellDimensions } from "@/app-shell/use-viewport-policy";
import type { ImageCapability } from "@/image";
import { Text } from "ink";
import React, { act } from "react";

import { render } from "../../harness/render-capture";

const originalPaneDetect = paneTesting.runtime.detectImageCapability;
const originalRendererDetect = rendererTesting.runtime.detectImageCapability;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function kittyCapability(): ImageCapability {
  return {
    terminal: "kitty",
    protocol: "kitty",
    renderer: "kitty-native",
    available: true,
    dependency: "none",
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

afterEach(() => {
  paneTesting.runtime.detectImageCapability = originalPaneDetect;
  rendererTesting.runtime.detectImageCapability = originalRendererDetect;
  process.stdout.write = originalStdoutWrite;
});

describe("usePosterPreview resize cleanup", () => {
  test("clears terminal image placements immediately when poster dimensions change", () => {
    paneTesting.runtime.detectImageCapability = kittyCapability;
    rendererTesting.runtime.detectImageCapability = kittyCapability;
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

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
