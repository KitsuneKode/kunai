/**
 * Resize the ip-as-logo PNG masters into the files the docs OG bake and the
 * CLI companion actually load. Source of truth remains the 1024² batch.
 *
 *   bun apps/docs/scripts/export-fox-assets.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { preparePoster } from "../../../apps/cli/src/image/native-image";

const ROOT = path.resolve(import.meta.dir, "../../..");
const BATCH = path.join(ROOT, ".reference/design/brand/ip-as-logo-batch");
const BRAND = path.join(ROOT, ".reference/design/brand");
const CLI_PETS = path.join(ROOT, "apps/cli/src/app-shell/brand/pets");

const POSES = {
  idle: "kunai-ip-C2-watcher-lr.png",
  watch: "kunai-ip-C1-watcher-ll.png",
  go: "kunai-ip-B1-courier-ll.png",
  wait: "kunai-ip-A1-operator-ll.png",
} as const;

async function exportPng(sourceName: string, dest: string, maxPx: number): Promise<number> {
  const source = path.join(BATCH, sourceName);
  const bytes = new Uint8Array(await Bun.file(source).arrayBuffer());
  const prepared = await preparePoster(bytes, { maxWidthPx: maxPx, maxHeightPx: maxPx });
  if (!prepared) {
    throw new Error(`failed to prepare ${sourceName}`);
  }
  await Bun.write(dest, prepared.png);
  return prepared.png.byteLength;
}

mkdirSync(CLI_PETS, { recursive: true });

const ogBytes = await exportPng(POSES.idle, path.join(BRAND, "kunai-mascot-og.png"), 320);
console.log(`kunai-mascot-og.png ${ogBytes} bytes`);

for (const [pose, file] of Object.entries(POSES)) {
  const dest = path.join(CLI_PETS, `${pose}.png`);
  const size = await exportPng(file, dest, 256);
  console.log(`${pose}.png ${size} bytes`);
}
