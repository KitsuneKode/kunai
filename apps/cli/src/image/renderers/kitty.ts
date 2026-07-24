import { ensurePngBytes } from "../convert";
import { prepareKittyPayload, uploadKittyPayload, type KittyPayload } from "../kitty-transport";
import type { ImageRenderOptions } from "../types";

export class NonPngError extends Error {
  constructor() {
    super("kitty-native could not decode or convert the input");
    this.name = "NonPngError";
  }
}

export async function renderKittyNative(
  filePath: string,
  options: ImageRenderOptions,
): Promise<void> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return;
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.byteLength === 0) return;

  let payload: KittyPayload | null = prepareKittyPayload(data);
  if (!payload) {
    // Exotic source (WebP, AVIF, …): ImageMagick is the last-resort converter.
    const png = await ensurePngBytes(data);
    if (!png) throw new NonPngError();
    payload = { kind: "png", data: png };
  }

  // No explicit image id on the legacy one-shot path: posters are meant to
  // accumulate in scrollback, and kitty evicts placement-less images itself
  // when it runs out of storage quota.
  await uploadKittyPayload(payload, {
    rows: options.maxRows,
    preferFileTransmission: true,
  });
  process.stdout.write("\n\n");
}
