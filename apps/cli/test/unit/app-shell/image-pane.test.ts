import { afterEach, describe, expect, test } from "bun:test";

import {
  __testing as paneTesting,
  clearRenderedPosterImages,
  fetchPoster,
  playbackPosterSurfacePhase,
  resolvePosterUrl,
  undisplayRenderedPosterImages,
} from "@/app-shell/image-pane";
import { __testing as posterRendererTesting } from "@/app-shell/poster-renderer";
import { isKittyCompatible } from "@/image";
import type { ImageCapability } from "@/image";

import { fakeChafaProcess } from "../../support/fake-chafa";
import { makeRgbPng } from "../../support/image-fixtures";

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

/**
 * A real, decodable PNG.
 *
 * These fixtures used to be a bare 9-byte PNG signature, which worked only
 * because the old Kitty path forwarded PNG-signed bytes to the terminal without
 * decoding them. Preparation decodes every source to bound and fit it, so a
 * fixture now has to be a real image.
 */
function realPng(): Uint8Array {
  return makeRgbPng(
    4,
    4,
    Array.from({ length: 4 * 4 * 3 }, (_, index) => (index * 17) % 256),
  );
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
  if (renderer === "sixel") {
    return {
      terminal: "windows-terminal",
      protocol: "sixel",
      renderer: "sixel",
      available: true,
      dependency: "none",
      reason: "test sixel",
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
  test("undisplaying Kitty posters drops cache so the next visit re-uploads", async () => {
    setFetchMock(async () => {
      const png = realPng();
      return new Response(png, { status: 200 });
    });
    process.stdout.write = (() => true) as typeof process.stdout.write;
    paneTesting.runtime.detectImageCapability = () => cap("kitty-native");
    posterRendererTesting.runtime.detectImageCapability = () => cap("kitty-native");

    const first = await fetchPoster("/cached.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
    });
    undisplayRenderedPosterImages();
    const revisited = await fetchPoster("/cached.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
    });

    expect(first.kind).toBe("kitty");
    expect(revisited.kind).toBe("kitty");
    // Source bytes may stay warm; Kitty placements must get a fresh imageId after d=A.
    if (first.kind === "kitty" && revisited.kind === "kitty") {
      expect(revisited.imageId).not.toBe(first.imageId);
    }
  });

  test("chafa text cache survives undisplay for back navigation", async () => {
    let fetchCalls = 0;
    setFetchMock(async () => {
      fetchCalls += 1;
      const png = realPng();
      return new Response(png, { status: 200 });
    });
    paneTesting.runtime.detectImageCapability = () => cap("chafa-symbols");
    posterRendererTesting.runtime.detectImageCapability = () => cap("chafa-symbols");
    posterRendererTesting.runtime.which = () => "/usr/bin/chafa";
    posterRendererTesting.runtime.spawn = () => fakeChafaProcess("ASCII_PREVIEW\n").proc;

    const first = await fetchPoster("/chafa.jpg", { rows: 4, cols: 8 });
    undisplayRenderedPosterImages();
    const revisited = await fetchPoster("/chafa.jpg", { rows: 4, cols: 8 });

    expect(first.kind).toBe("text");
    expect(revisited).toEqual(first);
    expect(fetchCalls).toBe(1);
  });

  test("cache key is segregated by renderer capability", async () => {
    setFetchMock(async () => {
      const png = realPng();
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
    posterRendererTesting.runtime.spawn = () => fakeChafaProcess("ASCII_PREVIEW\n").proc;
    const textResult = await fetchPoster("/abc.jpg", { rows: 4, cols: 8, allowKitty: true });
    expect(textResult.kind).toBe("text");
  });

  test("memoizes encoded sixel for repeated visits to the same title and slot", async () => {
    let fetchCalls = 0;
    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    setFetchMock(async () => {
      fetchCalls += 1;
      return new Response(png, { status: 200 });
    });
    paneTesting.runtime.detectImageCapability = () => cap("sixel");
    posterRendererTesting.runtime.detectImageCapability = () => cap("sixel");

    const first = await fetchPoster("/sixel-cache.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
    });
    const revisited = await fetchPoster("/sixel-cache.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
    });

    expect(first.kind).toBe("sixel");
    expect(revisited).toBe(first);
    expect(fetchCalls).toBe(1);
  });

  test("an older abort-capable render cannot evict a newer in-flight render", async () => {
    const png = makeRgbPng(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const responders: Array<(response: Response) => void> = [];
    let fetchCalls = 0;
    setFetchMock(
      () =>
        new Promise<Response>((resolve) => {
          fetchCalls += 1;
          responders.push(resolve);
        }),
    );
    paneTesting.runtime.detectImageCapability = () => cap("sixel");
    posterRendererTesting.runtime.detectImageCapability = () => cap("sixel");

    const firstAbort = new AbortController();
    const first = fetchPoster("/sixel-race.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
      signal: firstAbort.signal,
    });
    const second = fetchPoster("/sixel-race.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
      signal: new AbortController().signal,
    });
    expect(fetchCalls).toBe(2);

    firstAbort.abort();
    responders[0]?.(new Response(png, { status: 200 }));
    await first;

    // This caller has no signal, so it should join the newer task. Before the
    // ownership check in both inflight maps, completion of `first` deleted the
    // `second` entry and this became a third fetch/encode of identical input.
    const joined = fetchPoster("/sixel-race.jpg", {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
    });
    expect(fetchCalls).toBe(2);

    responders[1]?.(new Response(png, { status: 200 }));
    const [secondResult, joinedResult] = await Promise.all([second, joined]);
    expect(joinedResult).toBe(secondResult);
  });
});

describe("playback poster surface cleanup", () => {
  test("maps bootstrap operations to one phase and playing to its own", () => {
    expect(playbackPosterSurfacePhase("resolving")).toBe("bootstrap");
    expect(playbackPosterSurfacePhase("loading")).toBe("bootstrap");
    expect(playbackPosterSurfacePhase("playing")).toBe("playing");
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

  test("caps TMDB detail posters to resized proxy images", () => {
    expect(resolvePosterUrl("/poster.jpg", { cols: 18, variant: "detail" })).toBe(
      "https://image.tmdb.org/t/p/w500/poster.jpg",
    );
    expect(resolvePosterUrl("/poster.jpg", { cols: 40, variant: "detail" })).toBe(
      "https://image.tmdb.org/t/p/w780/poster.jpg",
    );
  });

  test("keeps image preview scoped to real terminal graphics protocols", () => {
    expect(isKittyCompatible({ TERM_PROGRAM: "xterm-256color" })).toBe(false);
  });
});
