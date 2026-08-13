import { afterEach, describe, expect, test } from "bun:test";

import {
  clearKittyPlacementRegistry,
  getKittyPlacement,
} from "@/app-shell/kitty-placement-registry";
import {
  __testing as rendererTesting,
  commitKittyPlacementCandidate,
  deleteUncommittedKittyCandidate,
  hashTitleToColor,
  renderPreparedPoster,
  resolvePosterRenderPlan,
  type PosterRenderPlan,
} from "@/app-shell/poster-renderer";
import type { ImageCapability } from "@/image";
import { preparePoster, type PreparedPoster } from "@/image/native-image";
import { __testing as probeTesting } from "@/image/probe";

import { makeRgbJpeg, makeRgbPng } from "../../support/image-fixtures";

const originalDetect = rendererTesting.runtime.detectImageCapability;
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalTransportEnv = process.env.KUNAI_IMAGE_TRANSPORT;

function capability(renderer: ImageCapability["renderer"]): ImageCapability {
  if (renderer === "none") {
    return {
      terminal: "unknown",
      protocol: "none",
      renderer: "none",
      available: false,
      reason: "test none",
    };
  }
  if (renderer === "half-block") {
    return {
      terminal: "windows-terminal",
      protocol: "half-block",
      renderer: "half-block",
      available: true,
      reason: "test half-block",
    };
  }
  if (renderer === "sixel") {
    return {
      terminal: "windows-terminal",
      protocol: "sixel",
      renderer: "sixel",
      available: true,
      reason: "test sixel",
    };
  }
  if (renderer === "iterm-inline") {
    return {
      terminal: "iterm2",
      protocol: "iterm-inline",
      renderer: "iterm-inline",
      available: true,
      reason: "test iterm",
    };
  }
  return {
    terminal: "kitty",
    protocol: "kitty",
    renderer: "kitty-native",
    available: true,
    reason: "test kitty",
  };
}

/** Hermetic escape assertions: force chunked base64 instead of t=t temp files. */
function forceDirectTransport(): void {
  process.env.KUNAI_IMAGE_TRANSPORT = "direct";
}

function gradient(width: number, height: number): number[] {
  return Array.from({ length: width * height * 3 }, (_, index) => (index * 23) % 256);
}

/** A prepared poster, built through the real preparation seam. */
async function prepared(width = 8, height = 8, rows = 4, cols = 8): Promise<PreparedPoster> {
  const poster = await preparePoster(makeRgbPng(width, height, gradient(width, height)), {
    maxWidthPx: cols * 10,
    maxHeightPx: rows * 20,
  });
  if (!poster) throw new Error("fixture failed to prepare");
  return poster;
}

function planFor(renderer: PosterRenderPlan["renderer"], rows = 4, cols = 8): PosterRenderPlan {
  return {
    renderer,
    bounds:
      renderer === "half-block"
        ? { maxWidthPx: cols, maxHeightPx: rows * 2 }
        : { maxWidthPx: cols * 10, maxHeightPx: rows * 20 },
  };
}

function captureStdout(): { writes: string[] } {
  const writes: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return { writes };
}

afterEach(() => {
  rendererTesting.runtime.detectImageCapability = originalDetect;
  process.stdout.write = originalStdoutWrite;
  if (originalTransportEnv === undefined) {
    delete process.env.KUNAI_IMAGE_TRANSPORT;
  } else {
    process.env.KUNAI_IMAGE_TRANSPORT = originalTransportEnv;
  }
  probeTesting.reset();
  clearKittyPlacementRegistry();
});

describe("resolvePosterRenderPlan", () => {
  test("routes a kitty terminal to kitty with a pixel budget", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");

    const plan = resolvePosterRenderPlan({ rows: 4, cols: 8 });

    expect(plan?.renderer).toBe("kitty-native");
    expect(plan?.bounds.maxWidthPx).toBeGreaterThan(8);
  });

  test("routes an iTerm2 terminal to inline images", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("iterm-inline");

    expect(resolvePosterRenderPlan({ rows: 4, cols: 8 })?.renderer).toBe("iterm-inline");
  });

  test("routes a sixel terminal to sixel", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("sixel");

    expect(resolvePosterRenderPlan({ rows: 4, cols: 8 })?.renderer).toBe("sixel");
  });

  test("half-block bounds double the height, for two pixels per cell row", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("half-block");

    const plan = resolvePosterRenderPlan({ rows: 4, cols: 8 });

    expect(plan).toEqual({
      renderer: "half-block",
      bounds: { maxWidthPx: 8, maxHeightPx: 8 },
    });
  });

  test("an Ink-embedded surface stays on text, where a placement would fight the layout", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");

    expect(resolvePosterRenderPlan({ rows: 4, cols: 8, inkEmbedded: true })?.renderer).toBe(
      "half-block",
    );
  });

  test("suppressing overlays sends sixel and inline images to text, not to nothing", () => {
    for (const renderer of ["sixel", "iterm-inline"] as const) {
      rendererTesting.runtime.detectImageCapability = () => capability(renderer);

      // Both are measured overlays outside Ink's frame, so a constantly
      // repainting surface must fall to text rather than lose the poster.
      expect(resolvePosterRenderPlan({ rows: 4, cols: 8, allowSixel: false })?.renderer).toBe(
        "half-block",
      );
    }
  });

  test("plans nothing when capability is unavailable, so no source is fetched", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("none");

    expect(resolvePosterRenderPlan({ rows: 4, cols: 8 })).toBeNull();
  });

  test("plans nothing for a degenerate geometry", () => {
    rendererTesting.runtime.detectImageCapability = () => capability("half-block");

    expect(resolvePosterRenderPlan({ rows: 0, cols: 8 })).toBeNull();
    expect(resolvePosterRenderPlan({ rows: 4, cols: 0 })).toBeNull();
  });

  test("a probe-detected kitty terminal without placeholders stays on text", () => {
    rendererTesting.runtime.detectImageCapability = () => ({
      ...capability("kitty-native"),
      terminal: "konsole",
    });

    // Konsole answers the kitty query but implements no Unicode placeholders, so
    // a placement would leave blank cells where the grid expects an image.
    expect(resolvePosterRenderPlan({ rows: 4, cols: 8 })?.renderer).toBe("half-block");
  });

  test("a probe-detected kitty terminal on an unknown name keeps placeholders", () => {
    probeTesting.setProbed({ sixel: false, kittyGraphics: true });
    rendererTesting.runtime.detectImageCapability = () => ({
      ...capability("kitty-native"),
      terminal: "unknown",
    });

    // kitty-over-ssh loses the name but still speaks the protocol.
    expect(resolvePosterRenderPlan({ rows: 4, cols: 8 })?.renderer).toBe("kitty-native");
  });
});

describe("renderPreparedPoster", () => {
  test("uploads the prepared PNG to kitty without any external binary", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    const { writes } = captureStdout();

    const candidate = await renderPreparedPoster(await prepared(), planFor("kitty-native"), {
      rows: 4,
      cols: 8,
    });

    expect(candidate.kind).toBe("kitty-upload");
    const escapes = writes.join("");
    expect(escapes).toContain("f=100"); // PNG, not RGBA
    expect(escapes).not.toContain("f=32");
  });

  test("a JPEG source reaches kitty as PNG, with no magick and no chafa", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    const { writes } = captureStdout();
    const poster = await preparePoster(makeRgbJpeg(8, 8, gradient(8, 8)), {
      maxWidthPx: 80,
      maxHeightPx: 80,
    });

    const candidate = await renderPreparedPoster(poster!, planFor("kitty-native"), {
      rows: 4,
      cols: 8,
    });

    expect(candidate.kind).toBe("kitty-upload");
    expect(writes.join("")).toContain("f=100");
  });

  test("an upload claims no placement slot until it is committed", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    captureStdout();

    const candidate = await renderPreparedPoster(await prepared(), planFor("kitty-native"), {
      rows: 4,
      cols: 8,
      placementSlot: "postplay-hero",
    });

    // Registering inside rendering is what let a superseded upload replace a
    // live placement, so the slot must still be empty here.
    expect(getKittyPlacement("postplay-hero")).toBeUndefined();

    if (candidate.kind === "kitty-upload") {
      commitKittyPlacementCandidate(candidate, "postplay-hero");
      expect(getKittyPlacement("postplay-hero")).toBe(candidate.imageId);
    }
  });

  test("a superseded upload can be dropped without disturbing the live slot", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    captureStdout();

    const live = await renderPreparedPoster(await prepared(), planFor("kitty-native"), {
      rows: 4,
      cols: 8,
      placementSlot: "postplay-hero",
    });
    if (live.kind !== "kitty-upload") throw new Error("expected an upload");
    commitKittyPlacementCandidate(live, "postplay-hero");

    const superseded = await renderPreparedPoster(await prepared(), planFor("kitty-native"), {
      rows: 4,
      cols: 8,
      placementSlot: "postplay-hero",
    });
    if (superseded.kind !== "kitty-upload") throw new Error("expected an upload");
    deleteUncommittedKittyCandidate(superseded);

    // The uncommitted id owns no slot, so dropping it must leave the committed
    // one in place rather than releasing the registry entry.
    expect(getKittyPlacement("postplay-hero")).toBe(live.imageId);
  });

  test("an aborted upload is discarded rather than returned", async () => {
    forceDirectTransport();
    rendererTesting.runtime.detectImageCapability = () => capability("kitty-native");
    captureStdout();
    const controller = new AbortController();
    controller.abort();

    const candidate = await renderPreparedPoster(await prepared(), planFor("kitty-native"), {
      rows: 4,
      cols: 8,
      signal: controller.signal,
    });

    expect(candidate.kind).toBe("none");
  });

  test("encodes a sixel overlay rather than putting escape bytes in Ink text", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("sixel");

    const candidate = await renderPreparedPoster(await prepared(), planFor("sixel"), {
      rows: 4,
      cols: 8,
      placementSlot: "browse-preview",
    });

    expect(candidate.kind).toBe("sixel");
    if (candidate.kind === "sixel") {
      expect(candidate.sixel.startsWith("P")).toBe(true);
      expect(candidate.overlayId).toBe("browse-preview");
    }
  });

  test("bounds the interactive sixel palette to keep ConPTY payloads responsive", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("sixel");

    const candidate = await renderPreparedPoster(await prepared(), planFor("sixel"), {
      rows: 4,
      cols: 8,
    });

    if (candidate.kind !== "sixel") throw new Error("expected sixel");
    const registers = new Set(candidate.sixel.match(/#(\d+);2;/g) ?? []);
    expect(registers.size).toBeLessThanOrEqual(rendererTesting.APP_SHELL_SIXEL_MAX_COLORS);
  });

  test("emits an iTerm2 inline image carrying the prepared PNG", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("iterm-inline");
    const poster = await prepared();

    const candidate = await renderPreparedPoster(poster, planFor("iterm-inline"), {
      rows: 4,
      cols: 8,
    });

    if (candidate.kind !== "sixel") throw new Error("expected an overlay result");
    expect(candidate.sixel).toContain("]1337;File=");
    expect(candidate.sixel).toContain(Buffer.from(poster.png).toString("base64"));
  });

  test("renders half-block text in process, with no external binary", async () => {
    rendererTesting.runtime.detectImageCapability = () => capability("half-block");

    const candidate = await renderPreparedPoster(await prepared(), planFor("half-block"), {
      rows: 4,
      cols: 8,
    });

    expect(candidate.kind).toBe("text");
    if (candidate.kind === "text") {
      // Two pixels per cell via the upper-half block, with truecolour SGR.
      expect(candidate.placeholder).toContain("▀");
      expect(candidate.placeholder).toContain("[38;2;");
    }
  });
});

describe("hashTitleToColor", () => {
  test("returns one of the 4 palette colors for any string", () => {
    for (const title of ["Dune", "", "a", "Severance", "アニメ"]) {
      expect(["amber", "teal", "purple", "pink"]).toContain(hashTitleToColor(title));
    }
  });

  test("same title always returns the same color", () => {
    expect(hashTitleToColor("Dune")).toBe(hashTitleToColor("Dune"));
  });

  test("different titles usually return different colors", () => {
    const colors = new Set(
      ["Dune", "Severance", "Arcane", "Andor", "Shogun"].map(hashTitleToColor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
