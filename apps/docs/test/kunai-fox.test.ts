import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import {
  KUNAI_FOX_POSES,
  KunaiFox,
  resolveFoxStill,
  type KunaiFoxFacing,
} from "../components/brand/kunai-fox";
import generatedMascot from "../lib/generated-mascot.json";

const DOCS_APP_ROOT = path.resolve(import.meta.dir, "..");
const FACINGS: readonly KunaiFoxFacing[] = ["left", "right"];

/**
 * Every still the site serves, plus the OG bake, has to stay small. The masters
 * are 1024² and ~900 KB each; before the export quantized them these were
 * ~100 KB apiece and the OG data URL was 137 KB inlined into two route bundles.
 */
const STILL_BUDGET_BYTES = 20_000;
const OG_DATA_URL_BUDGET_BYTES = 40_000;

function publicFile(src: string): string {
  return path.join(DOCS_APP_ROOT, "public", src.replace(/^\//, ""));
}

/**
 * Whether a file stores per-pixel alpha rather than a palette mask.
 *
 * This is the guard that matters, and it is read from the container header so
 * it needs no image tooling on the runner. A palette PNG keeps transparency in
 * a `tRNS` chunk — one value per palette entry — and a quantizer spends the
 * palette on colour, so the result is a two-level alpha: a 1-bit cutout with
 * hard stair-stepped edges, worst at nav size.
 */
function hasPerPixelAlpha(file: string): boolean {
  const bytes = fs.readFileSync(file);
  const tag = (start: number, end: number) => bytes.subarray(start, end).toString("ascii");

  if (tag(0, 4) === "RIFF" && tag(8, 12) === "WEBP") {
    // Extended (VP8X) headers flag alpha in bit 0x10 of the flags byte; lossy
    // WebP carries the channel in an ALPH chunk. Both are full 8-bit.
    const extendedAlpha = tag(12, 16) === "VP8X" && ((bytes[20] ?? 0) & 0x10) !== 0;
    return extendedAlpha || bytes.includes(Buffer.from("ALPH"));
  }

  // PNG IHDR colour type, 8-byte signature + 8-byte chunk header + 9.
  // 6 = truecolour+alpha, 4 = grey+alpha. 3 is the palette form to refuse.
  const colorType = bytes[25];
  return colorType === 6 || colorType === 4;
}

describe("fox stills on disk", () => {
  test("every pose and facing resolves to a file that exists", () => {
    for (const pose of KUNAI_FOX_POSES) {
      for (const facing of FACINGS) {
        const { src } = resolveFoxStill(pose, facing);
        expect(fs.existsSync(publicFile(src)), `${pose}/${facing} -> ${src}`).toBe(true);
      }
    }
  });

  test("every still carries a soft alpha edge, not a 1-bit cutout", () => {
    // Two things at once. The masters are opaque squares of #1c1620, so an
    // uncut still paints a box on whatever sits behind it. And a still cut to
    // only two alpha levels has hard stair-stepped edges, which is what a
    // palette PNG produces and what made the nav mark look ragged.
    for (const name of ["idle", "watch", "go", "go-left", "wait", "wait-right", "nav"]) {
      const file = path.join(DOCS_APP_ROOT, "public/brand/fox", `${name}.webp`);
      expect(hasPerPixelAlpha(file), `${name} per-pixel alpha`).toBe(true);
    }
  });

  test("the CLI pets keep per-pixel alpha too, and never become palette PNGs", () => {
    // The terminal is where an opaque or hard-edged pet is most obvious,
    // because the background belongs to the user, not to us.
    const pets = path.resolve(DOCS_APP_ROOT, "../cli/src/app-shell/brand/pets");
    for (const name of ["idle", "watch", "go", "wait"]) {
      const file = path.join(pets, `${name}.png`);
      expect(hasPerPixelAlpha(file), `${name} per-pixel alpha`).toBe(true);
    }
  });

  test("no still exceeds its size budget", () => {
    const dir = path.join(DOCS_APP_ROOT, "public/brand/fox");
    const files = fs.readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Nothing may reintroduce a palette PNG here — it is smaller, and its
      // transparency is a 1-bit mask.
      expect(file.endsWith(".webp"), `${file} is webp`).toBe(true);
      expect(fs.statSync(path.join(dir, file)).size, file).toBeLessThan(STILL_BUDGET_BYTES);
    }
  });

  test("the baked OG mascot stays inside the data-URL budget", () => {
    // This string is inlined into both the docs OG route and the share OG route.
    expect(generatedMascot.mascotDataUrl.length).toBeGreaterThan(0);
    expect(generatedMascot.mascotDataUrl.length).toBeLessThan(OG_DATA_URL_BUDGET_BYTES);
  });
});

describe("facing", () => {
  test("a drawn pair is used as drawn, never mirrored", () => {
    // `go` and `wait` are the only poses with a real mirrored master.
    for (const pose of ["go", "wait"] as const) {
      for (const facing of FACINGS) {
        expect(resolveFoxStill(pose, facing).mirrored, `${pose}/${facing}`).toBe(false);
      }
    }
    expect(resolveFoxStill("go", "left").src).not.toBe(resolveFoxStill("go", "right").src);
  });

  test("a pose drawn only one way is flipped rather than silently ignored", () => {
    // The shape this replaced returned the same file for both directions, so
    // `facing` was a prop that changed nothing on half the poses.
    for (const pose of ["idle", "watch"] as const) {
      const left = resolveFoxStill(pose, "left");
      const right = resolveFoxStill(pose, "right");
      expect(left.src, pose).toBe(right.src);
      expect(left.mirrored !== right.mirrored, `${pose} flips exactly one side`).toBe(true);
    }
  });
});

describe("rendering", () => {
  test("the mirrored class is what carries the flip", () => {
    const html = renderToStaticMarkup(KunaiFox({ pose: "idle", facing: "left" }));
    expect(html).toContain("kunai-fox--mirrored");
    expect(renderToStaticMarkup(KunaiFox({ pose: "idle", facing: "right" }))).not.toContain(
      "kunai-fox--mirrored",
    );
  });

  test("compact loads the nav still, not a corner-cropped pose still", () => {
    // At 28px the pose masters collapse into a smudge; several crop an ear.
    expect(renderToStaticMarkup(KunaiFox({ pose: "idle", size: 28, compact: true }))).toContain(
      "/brand/fox/nav.webp",
    );
  });

  test("she is decorative unless given a title", () => {
    const bare = renderToStaticMarkup(KunaiFox({ pose: "idle" }));
    expect(bare).toContain('alt=""');
    expect(bare).toContain("aria-hidden");

    const titled = renderToStaticMarkup(KunaiFox({ pose: "watch", title: "Kunai fox, waiting" }));
    expect(titled).toContain('alt="Kunai fox, waiting"');
    expect(titled).not.toContain("aria-hidden");
  });
});

describe("brand boundaries", () => {
  test("the favicon keeps the blade mark", () => {
    const icon = fs.readFileSync(path.join(DOCS_APP_ROOT, "app/icon.tsx"), "utf-8");
    expect(icon).toContain("KunaiMark");
    expect(icon).not.toContain("KunaiFox");
  });
});
