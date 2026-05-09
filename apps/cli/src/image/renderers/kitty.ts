import { ensurePngBytes } from "../convert";
import type { ImageRenderOptions } from "../types";

export class NonPngError extends Error {
  constructor() {
    super("kitty-native requires PNG input");
    this.name = "NonPngError";
  }
}

export async function renderKittyNative(
  filePath: string,
  options: ImageRenderOptions,
): Promise<void> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return;
  const data = await file.arrayBuffer();
  if (data.byteLength === 0) return;

  const png = await ensurePngBytes(new Uint8Array(data));
  if (!png) throw new NonPngError();

  const b64 = Buffer.from(png).toString("base64");
  if (b64.length === 0) return;

  const chunkSize = 4096;
  for (let i = 0; i < b64.length; i += chunkSize) {
    const chunk = b64.slice(i, i + chunkSize);
    const isFirst = i === 0;
    const isLast = i + chunkSize >= b64.length;
    const more = isLast ? 0 : 1;
    const ctrl = isFirst ? `a=T,f=100,q=2,r=${options.maxRows},m=${more}` : `m=${more}`;
    process.stdout.write(`\x1b_G${ctrl};${chunk}\x1b\\`);
  }

  process.stdout.write("\n\n");
}
