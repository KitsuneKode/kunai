import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isKittyCompatible } from "../image";
import type { PosterResult } from "./poster-types";

let _chafaAvailable: boolean | null = null;
export async function isChafaAvailable(): Promise<boolean> {
  if (_chafaAvailable !== null) return _chafaAvailable;
  _chafaAvailable = Boolean(Bun.which("chafa"));
  return _chafaAvailable;
}

let _magickAvailable: boolean | null = null;
async function isMagickAvailable(): Promise<boolean> {
  if (_magickAvailable !== null) return _magickAvailable;
  _magickAvailable = Boolean(Bun.which("magick"));
  return _magickAvailable;
}

let nextId = 1;
function allocId(): number {
  const id = nextId;
  nextId = (nextId % 65534) + 1;
  return id;
}

const renderedChafaCache = new Map<string, string>();
const MAX_RENDERED_CHAFA_CACHE = 32;

function cacheKeyForRender(data: ArrayBuffer, rows: number, cols: number): string {
  return `${Bun.hash(data)}:${rows}x${cols}`;
}

function rememberRenderedChafa(key: string, art: string): void {
  if (renderedChafaCache.size >= MAX_RENDERED_CHAFA_CACHE) {
    const first = renderedChafaCache.keys().next().value;
    if (first) renderedChafaCache.delete(first);
  }
  renderedChafaCache.set(key, art);
}

export function deleteKittyImage(imageId: number): void {
  process.stdout.write(`\x1b_Ga=d,d=I,i=${imageId};\x1b\\`);
}

export function deleteAllTerminalImages(): void {
  process.stdout.write("\x1b_Ga=d,d=A;\x1b\\");
}

const DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f, 0x0346, 0x034a, 0x034b, 0x034c,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0596, 0x0597, 0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0,
  0x05a1, 0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614,
  0x0615, 0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7,
  0x06d8, 0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2, 0x06e4, 0x06e7, 0x06e8,
  0x06eb, 0x06ec, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741,
  0x0743, 0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee, 0x07ef, 0x07f0, 0x07f1,
  0x07f3, 0x0816, 0x0817, 0x0818, 0x0819, 0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821,
  0x0822, 0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c, 0x082d, 0x0951, 0x0953,
  0x0954, 0x0f82, 0x0f83, 0x0f86, 0x0f87, 0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75,
  0x1a76, 0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d, 0x1b6e, 0x1b6f, 0x1b70,
  0x1b71, 0x1b72, 0x1b73, 0x1cd0, 0x1cd1, 0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1ce8, 0x1ced, 0x1cf4,
  0x1cf8, 0x1cf9, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4, 0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb,
  0x1dcc, 0x1dd1, 0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5, 0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9, 0x1dda, 0x1ddb,
  0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1, 0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe,
  0x20d0, 0x20d1, 0x20d4, 0x20d5, 0x20d6, 0x20d7, 0x20db, 0x20dc, 0x20e1, 0x20e7, 0x20e9, 0x20f0,
  0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2, 0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8,
  0x2de9, 0x2dea, 0x2deb, 0x2dec, 0x2ded, 0x2dee, 0x2def, 0x2df0, 0x2df1, 0x2df2, 0x2df3, 0x2df4,
  0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa, 0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f,
  0xa67c, 0xa67d, 0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1, 0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5, 0xa8e6, 0xa8e7,
  0xa8e8, 0xa8e9, 0xa8ea, 0xa8eb, 0xa8ec, 0xa8ed, 0xa8ee, 0xa8ef, 0xa8f0, 0xa8f1,
];

function encodeByte(b: number): string {
  const cp = DIACRITICS[b & 0xff] ?? 0x0305;
  return String.fromCodePoint(cp);
}

function buildPlaceholder(imageId: number, rows: number, cols: number): string {
  const cell = "\u{10EEEE}";
  const color = `\x1b[38;2;${(imageId >> 16) & 0xff};${(imageId >> 8) & 0xff};${imageId & 0xff}m`;
  const highIdByte = imageId > 0xffffff ? encodeByte((imageId >> 24) & 0xff) : "";
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const rowEnc = encodeByte(r);
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(cell + rowEnc + encodeByte(c) + highIdByte);
    }
    lines.push(`${color}${cells.join("")}\x1b[39m`);
  }
  return lines.join("\n");
}

async function uploadKitty(
  data: ArrayBuffer,
  imageId: number,
  rows: number,
  cols: number,
): Promise<void> {
  const b64 = Buffer.from(data).toString("base64");
  const chunkSize = 4096;
  for (let i = 0; i < b64.length || i === 0; i += chunkSize) {
    const chunk = b64.slice(i, i + chunkSize);
    const more = i + chunkSize < b64.length ? 1 : 0;
    const ctrl =
      i === 0 ? `a=T,f=100,U=1,q=2,i=${imageId},c=${cols},r=${rows},m=${more}` : `m=${more}`;
    process.stdout.write(`\x1b_G${ctrl};${chunk}\x1b\\`);
  }
}

function isPng(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 8));
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

async function ensureKittyPng(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  if (isPng(data)) return data;
  if (!(await isMagickAvailable())) return null;

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = join(tmpdir(), `kunai-poster-${id}.image`);
  const outputPath = join(tmpdir(), `kunai-poster-${id}.png`);
  try {
    await Bun.write(inputPath, data);
    const proc = Bun.spawn(["magick", inputPath, `png:${outputPath}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if ((await proc.exited) !== 0) return null;
    return await Bun.file(outputPath).arrayBuffer();
  } catch {
    return null;
  } finally {
    for (const path of [inputPath, outputPath]) {
      try {
        await unlink(path);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

async function renderKitty(data: ArrayBuffer, rows: number, cols: number): Promise<PosterResult> {
  const png = await ensureKittyPng(data);
  if (!png) return { kind: "none" };
  const imageId = allocId();
  await uploadKitty(png, imageId, rows, cols);
  return {
    kind: "kitty",
    placeholder: buildPlaceholder(imageId, rows, cols),
    rows,
    cols,
    imageId,
  };
}

async function renderChafa(data: ArrayBuffer, rows: number, cols: number): Promise<PosterResult> {
  const cacheKey = cacheKeyForRender(data, rows, cols);
  const cached = renderedChafaCache.get(cacheKey);
  if (cached) return { kind: "chafa", art: cached, rows, cols };

  const tmpPath = join(
    tmpdir(),
    `kunai-poster-${Date.now()}-${Math.random().toString(16).slice(2)}.img`,
  );
  await Bun.write(tmpPath, data);
  try {
    const proc = Bun.spawn(
      ["chafa", "--size", `${cols}x${rows}`, "--format", "symbols", "--colors", "full", tmpPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const art = await new Response(proc.stdout).text();
    await proc.exited;
    if (!art.trim()) return { kind: "none" };
    rememberRenderedChafa(cacheKey, art);
    return { kind: "chafa", art, rows, cols };
  } catch {
    return { kind: "none" };
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // best-effort cleanup
    }
  }
}

export async function renderPoster(
  data: ArrayBuffer,
  { rows, cols, allowKitty = true }: { rows: number; cols: number; allowKitty?: boolean },
): Promise<PosterResult> {
  try {
    if (allowKitty && isKittyCompatible()) {
      const kitty = await renderKitty(data, rows, cols);
      if (kitty.kind !== "none") return kitty;
      if (await isChafaAvailable()) {
        return await renderChafa(data, rows, cols);
      }
      return { kind: "none" };
    }
    if (await isChafaAvailable()) {
      return await renderChafa(data, rows, cols);
    }
    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}
