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

/** Colour type from IHDR, and whether a tRNS chunk carries the transparency. */
function pngAlphaShape(file: string): { readonly colorType: number; readonly hasTrns: boolean } {
  const bytes = fs.readFileSync(file);
  // 8-byte signature, then IHDR: 4 length + 4 type + 13 data, colour type at +9.
  return { colorType: bytes[25] as number, hasTrns: bytes.includes(Buffer.from("tRNS")) };
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

  test("every still is cut to alpha, so it never paints a plate on its surface", () => {
    // The masters are opaque squares of #1c1620. Shipped uncut they show as a
    // lighter box on the hero and a dark box over a light terminal background.
    for (const name of ["idle", "watch", "go", "go-left", "wait", "wait-right", "nav"]) {
      const shape = pngAlphaShape(path.join(DOCS_APP_ROOT, "public/brand/fox", `${name}.png`));
      expect(shape.colorType, `${name} colour type`).toBe(3);
      expect(shape.hasTrns, `${name} tRNS`).toBe(true);
    }
  });

  test("no still exceeds its size budget", () => {
    const dir = path.join(DOCS_APP_ROOT, "public/brand/fox");
    for (const file of fs.readdirSync(dir)) {
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
      "/brand/fox/nav.png",
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
