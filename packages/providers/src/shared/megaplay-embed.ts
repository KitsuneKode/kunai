/**
 * MegaPlay embed contract — shared by AnimeKai and HiAnime's HD-1/Vidstream-2
 * lanes, which all resolve to `megaplay.buzz/stream/…` player pages.
 *
 * The page carries `data-id`; `stream/getSources?id=<id>` (plus the page URL's
 * `s` CDN selector, forwarded by the page's own GetSourcesRewrite hook) answers
 * `{enc, tracks, intro, outro}`. `enc` is base64url of an AES-256-CBC-encrypted
 * JSON payload whose `file` is the HLS master. Key and IV are the `trustAesKey`
 * / `trustAesIv` defaults inside `newclient.min.js` — the 16-byte key zero-pads
 * to AES-256.
 */

export type MegaplayEmbedDecodeErrorCode =
  | "missing-data-id"
  | "decrypt-failed"
  | "missing-playlist";

export class MegaplayEmbedDecodeError extends Error {
  readonly code: MegaplayEmbedDecodeErrorCode;
  constructor(code: MegaplayEmbedDecodeErrorCode, message: string) {
    super(message);
    this.name = "MegaplayEmbedDecodeError";
    this.code = code;
  }
}

/**
 * The 16-byte ASCII key the player zero-pads to AES-256, and the 16-byte IV —
 * the literal defaults in newclient.min.js's `trustAesKey`/`trustAesIv` picks.
 * Constants rotate with the site — a decode that stops producing JSON means
 * re-derive them from the embed's newclient.min.js.
 */
export const MEGAPLAY_AES_KEY = "i?LMTAx0Q6,:}50U";
export const MEGAPLAY_AES_IV = "W0;27ToaUpl_P%'c";

/** `data-id` on the embed page is the player id the sources endpoint wants. */
export function parseMegaplayEmbedDataId(html: string): string | null {
  const match = /\bdata-id\s*=\s*["'](\d+)["']/i.exec(html);
  return match?.[1] ?? null;
}

/**
 * Every sources id the page carries, in preference order. Some deployments key
 * `getSources` on `data-mediaid` while `data-id` decrypts to an empty payload —
 * try them in order and let the decrypt decide. `data-mediaid` first, then
 * `data-id`, deduped.
 */
export function parseMegaplayEmbedSourceIds(html: string): readonly string[] {
  const ids: string[] = [];
  for (const name of ["data-mediaid", "data-id"] as const) {
    const match = new RegExp(`\\b${name}\\s*=\\s*["'](\\d+)["']`, "i").exec(html);
    const id = match?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface MegaplaySourcesPayload {
  readonly enc: string;
  readonly tracks: readonly {
    readonly file: string;
    readonly label?: string;
    readonly kind?: string;
    readonly isDefault?: boolean;
  }[];
  readonly intro?: { readonly start: number; readonly end: number };
  readonly outro?: { readonly start: number; readonly end: number };
}

/* oxlint-disable anti-slop/no-runtime-typeof anti-slop/no-unknown-parameters anti-slop/no-unknown-returns anti-slop/no-unsafe-dictionary-type -- this module IS the I/O-boundary parser for megaplay's untyped upstream JSON; the duck-type probes below establish the contract, and providers carry no schema-runtime dep */

/** `getSources` JSON: `enc` blob, subtitle `tracks`, and `intro`/`outro`. */
export function parseMegaplaySourcesJson(json: unknown): MegaplaySourcesPayload | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  // SAFETY: object-guarded above; upstream keys are probed individually below.
  const data = json as { enc?: unknown; tracks?: unknown; intro?: unknown; outro?: unknown };
  const enc = data.enc;
  if (typeof enc !== "string" || !enc) return null;

  const tracks: {
    file: string;
    label?: string;
    kind?: string;
    isDefault?: boolean;
  }[] = [];
  const rawTracks = data.tracks;
  if (Array.isArray(rawTracks)) {
    for (const track of rawTracks) {
      if (!track || typeof track !== "object") continue;
      // SAFETY: object-guarded above; each field is probed as unknown before use.
      const {
        file,
        label,
        kind,
        default: defaultFlag,
      } = track as { file?: unknown; label?: unknown; kind?: unknown; default?: unknown };
      if (typeof file !== "string" || !/^https?:\/\//i.test(file)) continue;
      const isDefault = defaultFlag === true;
      tracks.push({
        file,
        ...(typeof label === "string" && label.trim() && { label: label.trim() }),
        ...(typeof kind === "string" && kind.trim() && { kind: kind.trim() }),
        ...(isDefault && { isDefault }),
      });
    }
  }

  const segment = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    // SAFETY: object-guarded above; start/end probed as unknown before numeric checks.
    const { start, end } = value as { start?: unknown; end?: unknown };
    if (typeof start !== "number" || typeof end !== "number" || !(end > start)) return undefined;
    return { start, end };
  };

  const intro = segment(data.intro);
  const outro = segment(data.outro);
  return {
    enc,
    tracks,
    ...(intro && { intro }),
    ...(outro && { outro }),
  };
}

/** base64url → bytes; openssl/base64url both drop padding. */
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function decryptMegaplaySourcesBlob(enc: string): Promise<unknown> {
  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode(MEGAPLAY_AES_KEY));
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
      "decrypt",
    ]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: new TextEncoder().encode(MEGAPLAY_AES_IV) },
      key,
      decodeBase64Url(enc),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new MegaplayEmbedDecodeError(
      "decrypt-failed",
      "megaplay sources blob failed AES-CBC decrypt — upstream key may have rotated",
    );
  }
}

/** Decrypted blob → `{file: <master m3u8>}`; the only field the stream needs. */
export function megaplayMasterUrlFromDecrypted(json: unknown): string {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new MegaplayEmbedDecodeError(
      "decrypt-failed",
      "megaplay decrypted sources payload is not an object",
    );
  }
  // SAFETY: object-guarded above; `file` is probed as unknown before the regex check.
  const file = (json as { file?: unknown }).file;
  if (typeof file !== "string" || !/\.m3u8(\?|$|#)/i.test(file)) {
    throw new MegaplayEmbedDecodeError(
      "missing-playlist",
      "megaplay decrypted sources payload carries no m3u8 file",
    );
  }
  // JSON escapes `/` as `\/` in some server revisions.
  return file.replace(/\\\//g, "/");
}

/**
 * `getSources` lives on the embed origin and takes the page's `data-id`. The
 * embed URL's `s` CDN selector is forwarded verbatim — the page's own
 * GetSourcesRewrite hook does exactly this to the player's XHR, and `s=tcdn`
 * vs unset resolves to different CDN hosts upstream.
 */
export function megaplaySourcesEndpoint(embedUrl: string, dataId: string): string {
  const url = new URL(embedUrl);
  const endpoint = `${url.origin}/stream/getSources?id=${encodeURIComponent(dataId)}`;
  const cdnSelector = url.searchParams.get("s");
  return cdnSelector ? `${endpoint}&s=${encodeURIComponent(cdnSelector)}` : endpoint;
}

export function megaplayEmbedReferer(embedUrl: string): string {
  try {
    return `${new URL(embedUrl).origin}/`;
  } catch {
    return "https://megaplay.buzz/";
  }
}
