/**
 * Pure HiAnime ZokoAnime embed decoding (ani-cli `deobfuscate_blob` parity).
 *
 * The embed page ships its player config as `window.__P="<base64>"`, which is
 * `base64(JSON XOR "otaku-embed-v1")`. Every stage that can fail raises its own
 * code so a key rotation is never mistaken for a network block.
 */

export const HIANIME_EMBED_XOR_KEY = "otaku-embed-v1";

export type HianimeEmbedDecodeFailureCode =
  | "embed-blob-missing"
  | "embed-base64-invalid"
  | "embed-json-syntax-invalid"
  | "embed-json-shape-invalid";

export class HianimeEmbedDecodeError extends Error {
  readonly code: HianimeEmbedDecodeFailureCode;

  constructor(code: HianimeEmbedDecodeFailureCode) {
    super(code);
    this.name = "HianimeEmbedDecodeError";
    this.code = code;
  }
}

export interface HianimeEmbedSubtitle {
  readonly lang?: string;
  readonly label?: string;
  readonly isDefault?: boolean;
  readonly src: string;
}

export interface HianimeEmbedSkipSegment {
  readonly start: number;
  readonly end: number;
}

export interface HianimeEmbedPayload {
  /** Master HLS playlist URL. */
  readonly src: string;
  readonly subtitles: readonly HianimeEmbedSubtitle[];
  readonly intro?: HianimeEmbedSkipSegment;
  readonly outro?: HianimeEmbedSkipSegment;
  readonly downloadUrl?: string;
  readonly poster?: string;
  readonly spriteVtt?: string;
}

/** Extract the raw `window.__P` blob from an embed page, if present. */
export function extractHianimeEmbedBlob(html: string): string | null {
  const match = /window\.__P="([^"]*)"/.exec(html);
  const blob = match?.[1];
  return blob ? blob : null;
}

/**
 * Reverse `base64(json XOR key)`. Accepts the key as an override so a rotation
 * is one argument, not a rewrite — and so tests can prove the XOR round-trips.
 */
export function deobfuscateHianimeEmbedBlob(
  blob: string,
  key: string = HIANIME_EMBED_XOR_KEY,
): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(blob) || blob.length === 0 || blob.length % 4 !== 0) {
    throw new HianimeEmbedDecodeError("embed-base64-invalid");
  }
  let encrypted: Buffer;
  try {
    encrypted = Buffer.from(blob, "base64");
  } catch {
    throw new HianimeEmbedDecodeError("embed-base64-invalid");
  }
  if (encrypted.length === 0) throw new HianimeEmbedDecodeError("embed-base64-invalid");
  const keyBytes = Buffer.from(key, "utf8");
  const out = Buffer.alloc(encrypted.length);
  for (let i = 0; i < encrypted.length; i++) {
    out[i] = (encrypted[i] ?? 0) ^ (keyBytes[i % keyBytes.length] ?? 0);
  }
  return out.toString("utf8");
}

/** Test/rotation seam: the forward direction of the obfuscation. */
export function obfuscateHianimeEmbedPayload(
  json: string,
  key: string = HIANIME_EMBED_XOR_KEY,
): string {
  const plain = Buffer.from(json, "utf8");
  const keyBytes = Buffer.from(key, "utf8");
  const out = Buffer.alloc(plain.length);
  for (let i = 0; i < plain.length; i++) {
    out[i] = (plain[i] ?? 0) ^ (keyBytes[i % keyBytes.length] ?? 0);
  }
  return out.toString("base64");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function parseSkipSegment(value: unknown): HianimeEmbedSkipSegment | undefined {
  if (!isRecord(value)) return undefined;
  const { start, end } = value;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0)
    return undefined;
  return { start, end };
}

/** Parse + shape-check one decoded embed JSON document. */
export function parseHianimeEmbedPayload(json: string): HianimeEmbedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new HianimeEmbedDecodeError("embed-json-syntax-invalid");
  }
  if (!isRecord(parsed) || !isHttpUrl(parsed.src)) {
    throw new HianimeEmbedDecodeError("embed-json-shape-invalid");
  }
  const rawSubtitles = Array.isArray(parsed.subtitles) ? parsed.subtitles : [];
  const subtitles: HianimeEmbedSubtitle[] = [];
  for (const entry of rawSubtitles) {
    if (!isRecord(entry) || !isHttpUrl(entry.src)) continue;
    subtitles.push({
      ...(typeof entry.lang === "string" ? { lang: entry.lang } : {}),
      ...(typeof entry.label === "string" ? { label: entry.label } : {}),
      ...(entry.default === true ? { isDefault: true as const } : {}),
      src: (entry.src as string).trim(),
    });
  }
  const skip = isRecord(parsed.skip) ? parsed.skip : undefined;
  const intro = parseSkipSegment(skip?.intro);
  const outro = parseSkipSegment(skip?.outro);
  const downloadUrl =
    typeof parsed.download_url === "string" && parsed.download_url.trim()
      ? parsed.download_url.trim()
      : undefined;
  const poster =
    typeof parsed.poster === "string" && parsed.poster.trim() ? parsed.poster.trim() : undefined;
  const spriteVtt =
    typeof parsed.sprite_vtt === "string" && parsed.sprite_vtt.trim()
      ? parsed.sprite_vtt.trim()
      : undefined;
  return {
    src: (parsed.src as string).trim(),
    subtitles,
    ...(intro ? { intro } : {}),
    ...(outro ? { outro } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(poster ? { poster } : {}),
    ...(spriteVtt ? { spriteVtt } : {}),
  };
}

/** Decode one embed page end to end: blob → JSON payload. */
export function decodeHianimeEmbedPage(html: string): HianimeEmbedPayload {
  const blob = extractHianimeEmbedBlob(html);
  if (!blob) throw new HianimeEmbedDecodeError("embed-blob-missing");
  return parseHianimeEmbedPayload(deobfuscateHianimeEmbedBlob(blob));
}

/** MAL id rides the embed URL path (`/stream/mal/<id>/…`) — the auto-skip anchor. */
export function hianimeMalIdFromEmbedUrl(embedUrl: string): string | undefined {
  const match = /\/mal\/(\d+)(?:\/|$)/.exec(embedUrl);
  const id = match?.[1];
  return id && /^[1-9]\d*$/.test(id) ? id : undefined;
}

/** The stream host wants the embed site as referer (ani-cli `refr`). */
export function hianimeEmbedReferer(embedUrl: string): string {
  try {
    return `${new URL(embedUrl).origin}/`;
  } catch {
    return "https://zokoanime.video/";
  }
}
