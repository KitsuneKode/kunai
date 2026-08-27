/**
 * Resize the ip-as-logo PNG masters into the files the docs site and OG bake
 * actually load. Source of truth remains the 1024² batch. CLI pets are a
 * separate 8-colour set — do not overwrite them from this path.
 *
 *   bun apps/docs/scripts/export-fox-assets.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const BATCH = path.join(ROOT, ".reference/design/brand/ip-as-logo-batch");
const BRAND = path.join(ROOT, ".reference/design/brand");
const DOCS_STILLS = path.join(ROOT, "apps/docs/public/brand/fox");

const DOCS_STILLS_BY_NAME = {
  wait: "kunai-ip-A1-operator-ll.png",
  "wait-right": "kunai-ip-A2-operator-lr.png",
  go: "kunai-ip-B1-courier-ll.png",
  "go-left": "kunai-ip-B2-courier-lr.png",
  watch: "kunai-ip-C1-watcher-ll.png",
  idle: "kunai-ip-C2-watcher-lr.png",
} as const;

type BunImage = {
  resize: (
    width: number,
    height: number,
    options: { readonly fit: "inside"; readonly withoutEnlargement: true },
  ) => BunImage;
  png: () => BunImage;
  bytes: () => Promise<Uint8Array> | Uint8Array;
};

function bunImageCtor():
  | (new (
      input: Uint8Array,
      options: { readonly maxPixels: number; readonly autoOrient: boolean },
    ) => BunImage)
  | null {
  const candidate = (Bun as { Image?: unknown }).Image;
  return typeof candidate === "function"
    ? (candidate as new (
        input: Uint8Array,
        options: { readonly maxPixels: number; readonly autoOrient: boolean },
      ) => BunImage)
    : null;
}

async function exportPng(sourceName: string, dest: string, maxPx: number): Promise<number> {
  const Image = bunImageCtor();
  if (!Image) {
    throw new Error("Bun.Image is required to export fox stills");
  }
  const source = path.join(BATCH, sourceName);
  const bytes = new Uint8Array(await Bun.file(source).arrayBuffer());
  const png = new Uint8Array(
    await new Image(bytes, { maxPixels: 4096 * 4096, autoOrient: true })
      .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
      .png()
      .bytes(),
  );
  await Bun.write(dest, png);
  return png.byteLength;
}

mkdirSync(DOCS_STILLS, { recursive: true });

for (const [name, file] of Object.entries(DOCS_STILLS_BY_NAME)) {
  const dest = path.join(DOCS_STILLS, `${name}.png`);
  const size = await exportPng(file, dest, 320);
  console.log(`docs ${name}.png ${size} bytes`);
}

const idleStill = path.join(DOCS_STILLS, "idle.png");
const ogDest = path.join(BRAND, "kunai-mascot-og.png");
const ogBytes = await Bun.write(ogDest, await Bun.file(idleStill).bytes());
console.log(`kunai-mascot-og.png ${ogBytes} bytes (idle still)`);
