import { afterEach, describe, expect, test } from "bun:test";

import {
  __testing as paneTesting,
  clearRenderedPosterImages,
  fetchPoster,
  resolvePosterUrl,
} from "@/app-shell/image-pane";
import { __testing as posterRendererTesting } from "@/app-shell/poster-renderer";
import { isKittyCompatible } from "@/image";
import type { ImageCapability } from "@/image";

const originalFetch = globalThis.fetch;
const originalPaneDetect = paneTesting.runtime.detectImageCapability;
const originalRendererDetect = posterRendererTesting.runtime.detectImageCapability;
const originalRendererWhich = posterRendererTesting.runtime.which;
const originalRendererSpawn = posterRendererTesting.runtime.spawn;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

function setFetchMock(
  handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): void {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  }) as typeof fetch;
}

function cap(renderer: ImageCapability["renderer"]): ImageCapability {
  if (renderer === "kitty-native") {
    return {
      terminal: "kitty",
      protocol: "kitty",
      renderer: "kitty-native",
      available: true,
      dependency: "none",
      reason: "test kitty",
    };
  }
  if (renderer === "chafa-symbols") {
    return {
      terminal: "unknown",
      protocol: "symbols",
      renderer: "chafa-symbols",
      available: true,
      dependency: "chafa",
      reason: "test symbols",
    };
  }
  return {
    terminal: "unknown",
    protocol: "none",
    renderer: "none",
    available: false,
    dependency: "none",
    reason: "test none",
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  paneTesting.runtime.detectImageCapability = originalPaneDetect;
  posterRendererTesting.runtime.detectImageCapability = originalRendererDetect;
  posterRendererTesting.runtime.which = originalRendererWhich;
  posterRendererTesting.runtime.spawn = originalRendererSpawn;
  process.stdout.write = originalStdoutWrite;
  clearRenderedPosterImages();
});

describe("app-shell image pane cache", () => {
  test("cache key is segregated by renderer capability", async () => {
    setFetchMock(async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      return new Response(png, { status: 200 });
    });

    process.stdout.write = (() => true) as typeof process.stdout.write;

    paneTesting.runtime.detectImageCapability = () => cap("kitty-native");
    posterRendererTesting.runtime.detectImageCapability = () => cap("kitty-native");
    const kittyFirst = await fetchPoster("/abc.jpg", { rows: 4, cols: 8, allowKitty: true });
    const kittySecond = await fetchPoster("/abc.jpg", { rows: 4, cols: 8, allowKitty: true });
    expect(kittyFirst.kind).toBe("kitty");
    expect(kittySecond.kind).toBe("kitty");
    if (kittyFirst.kind === "kitty" && kittySecond.kind === "kitty") {
      expect(kittySecond.imageId).toBe(kittyFirst.imageId);
    }

    paneTesting.runtime.detectImageCapability = () => cap("chafa-symbols");
    posterRendererTesting.runtime.detectImageCapability = () => cap("chafa-symbols");
    posterRendererTesting.runtime.which = () => "/usr/bin/chafa";
    posterRendererTesting.runtime.spawn = () =>
      ({
        stdout: new Response("ASCII_PREVIEW\n").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
      }) as unknown as Bun.Subprocess;
    const textResult = await fetchPoster("/abc.jpg", { rows: 4, cols: 8, allowKitty: true });
    expect(textResult.kind).toBe("text");
  });
});

describe("poster image helpers", () => {
  test("resolves TMDB poster paths to fetchable image URLs", () => {
    expect(resolvePosterUrl("/poster.jpg")).toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
  });

  test("preserves absolute poster URLs", () => {
    expect(resolvePosterUrl("https://cdn.example.test/poster.jpg")).toBe(
      "https://cdn.example.test/poster.jpg",
    );
  });

  test("preserves local image artifact paths", () => {
    expect(resolvePosterUrl("/tmp/kunai/downloads/example.thumbnail.jpg")).toBe(
      "/tmp/kunai/downloads/example.thumbnail.jpg",
    );
    expect(resolvePosterUrl("file:///tmp/kunai/downloads/example.thumbnail.jpg")).toBe(
      "/tmp/kunai/downloads/example.thumbnail.jpg",
    );
  });

  test("detects Kitty and Ghostty terminal graphics support", () => {
    expect(isKittyCompatible({ KITTY_WINDOW_ID: "1" })).toBe(true);
    expect(isKittyCompatible({ TERM_PROGRAM: "Ghostty" })).toBe(true);
    expect(isKittyCompatible({ TERM_PROGRAM: "xterm-256color" })).toBe(false);
  });

  test("uses a larger TMDB size for wider preview panes", () => {
    expect(resolvePosterUrl("/poster.jpg", { cols: 24 })).toBe(
      "https://image.tmdb.org/t/p/w500/poster.jpg",
    );
  });

  test("uses original TMDB size for detail contexts", () => {
    expect(resolvePosterUrl("/poster.jpg", { cols: 18, variant: "detail" })).toBe(
      "https://image.tmdb.org/t/p/original/poster.jpg",
    );
  });

  test("keeps image preview scoped to real terminal graphics protocols", () => {
    expect(isKittyCompatible({ TERM_PROGRAM: "xterm-256color" })).toBe(false);
  });
});
