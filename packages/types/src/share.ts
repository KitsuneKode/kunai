// Portable, dependency-free share-link codec used by both the CLI and docs app.

export type CatalogNs = "tmdb" | "anilist" | "mal" | "imdb" | "youtube";

export type ShareAnchor =
  | { readonly by: "catalog"; readonly ns: CatalogNs; readonly id: string }
  | { readonly by: "search"; readonly query: string };

export type PlaybackTargetRef = {
  readonly anchor: ShareAnchor;
  readonly kind: "movie" | "series" | "anime" | "video";
  readonly season?: number;
  readonly episode?: number;
  readonly absoluteEpisode?: number;
  readonly startSeconds?: number;
  readonly title?: string;
  readonly hint?: { readonly providerId: string; readonly quality?: string };
};

export type KunaiShareAction = "play" | "download";

export type ParsedKunaiShare = {
  readonly action: KunaiShareAction;
  readonly ref: PlaybackTargetRef;
  readonly presentation?: WebSharePresentation;
};

export type WebSharePresentation = {
  readonly posterUrl?: string;
};

export const KUNAI_WEB_SHARE_ORIGIN = "https://kunai.kitsunekode.in";

const WEB_CODE_PREFIX = "v1.";
const SHORT_CODE_PREFIX = "k1";
const MAX_WEB_CODE_LENGTH = 4_096;
const MAX_SHORT_CODE_LENGTH = 2_048;
const MAX_DECODED_PAYLOAD_BYTES = 3_072;
const MAX_COMPACT_TEXT_BYTES = 256;
const MAX_POSTER_URL_LENGTH = 2_048;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CATALOG_NS: ReadonlySet<string> = new Set(["tmdb", "anilist", "mal", "imdb", "youtube"]);
const PARAM_ORDER = ["cat", "q", "kind", "s", "e", "abs", "t", "src", "sq", "n"] as const;
const ACTION_TO_CODE: Readonly<Record<KunaiShareAction, string>> = {
  play: "p",
  download: "d",
};
const CODE_TO_ACTION = { p: "play", d: "download" } as const;
const NS_TO_CODE: Readonly<Record<CatalogNs, string>> = {
  tmdb: "t",
  anilist: "a",
  mal: "m",
  imdb: "i",
  youtube: "y",
};
const CODE_TO_NS = { t: "tmdb", a: "anilist", m: "mal", i: "imdb", y: "youtube" } as const;
const KIND_TO_CODE: Readonly<Record<PlaybackTargetRef["kind"], string>> = {
  movie: "m",
  series: "s",
  anime: "a",
  video: "v",
};
const CODE_TO_KIND = { m: "movie", s: "series", a: "anime", v: "video" } as const;

export function parseTimestampToSeconds(raw: string | null | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const seconds = Number.parseInt(value, 10);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(value);
  if (clock) {
    const h = clock[1] ? Number.parseInt(clock[1], 10) : 0;
    const m = Number.parseInt(clock[2] ?? "", 10);
    const s = Number.parseInt(clock[3] ?? "", 10);
    if (m > 59 || s > 59) return null;
    const total = h * 3600 + m * 60 + s;
    return Number.isSafeInteger(total) ? total : null;
  }
  const human = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (human && (human[1] || human[2] || human[3])) {
    const h = human[1] ? Number.parseInt(human[1], 10) : 0;
    const m = human[2] ? Number.parseInt(human[2], 10) : 0;
    const s = human[3] ? Number.parseInt(human[3], 10) : 0;
    const total = h * 3600 + m * 60 + s;
    return Number.isSafeInteger(total) ? total : null;
  }
  return null;
}

export function formatSecondsForUrl(seconds: number): string {
  return String(Math.max(0, Math.round(seconds)));
}

export function encodePlaybackTargetRef(
  ref: PlaybackTargetRef,
  action: KunaiShareAction = "play",
): string {
  return `kunai://${action}?${encodePlaybackTargetQuery(ref)}`;
}

export function encodePlaybackTargetWebUrl(
  ref: PlaybackTargetRef,
  action: KunaiShareAction = "play",
  presentation?: WebSharePresentation,
): string {
  const protocolPayload = `${action}?${encodePlaybackTargetQuery(ref)}`;
  const posterUrl = normalizePosterUrl(presentation?.posterUrl);
  const enrichedPayload = posterUrl
    ? `${protocolPayload}\nposter=${encodeURIComponent(posterUrl)}`
    : protocolPayload;
  const payload = webPayloadFits(enrichedPayload) ? enrichedPayload : protocolPayload;
  const payloadBytes = new TextEncoder().encode(payload);
  const bytes = new Uint8Array(payloadBytes.length + 4);
  bytes.set(payloadBytes);
  new DataView(bytes.buffer).setUint32(payloadBytes.length, crc32(payloadBytes));
  const code = `${WEB_CODE_PREFIX}${encodeBase64Url(bytes)}`;
  if (payloadBytes.length > MAX_DECODED_PAYLOAD_BYTES || code.length > MAX_WEB_CODE_LENGTH) {
    throw new Error("Playback target is too large for a bounded web share link");
  }
  return `${KUNAI_WEB_SHARE_ORIGIN}/w/${code}`;
}

export function decodePlaybackTargetWebCode(code: string): ParsedKunaiShare | null {
  if (code.startsWith(SHORT_CODE_PREFIX)) return parseCompactShareCode(code);
  if (
    !code.startsWith(WEB_CODE_PREFIX) ||
    code.length > MAX_WEB_CODE_LENGTH ||
    code.length === WEB_CODE_PREFIX.length
  ) {
    return null;
  }
  const bytes = decodeBase64Url(code.slice(WEB_CODE_PREFIX.length));
  if (!bytes || bytes.length < 5 || bytes.length > MAX_DECODED_PAYLOAD_BYTES + 4) return null;
  const payloadBytes = bytes.subarray(0, -4);
  const expectedChecksum = new DataView(
    bytes.buffer,
    bytes.byteOffset + bytes.length - 4,
    4,
  ).getUint32(0);
  if (crc32(payloadBytes) !== expectedChecksum) return null;
  const payload = decodeUtf8(payloadBytes);
  if (!payload) return null;
  const [protocolPayload, presentationLine, ...unexpectedLines] = payload.split("\n");
  if (!protocolPayload || unexpectedLines.length > 0) return null;
  const parsed = parseKunaiProtocolUrl(`kunai://${protocolPayload}`);
  if (!parsed) return null;
  if (!presentationLine) return parsed;
  if (!presentationLine.startsWith("poster=")) return null;
  let decodedPosterUrl: string;
  try {
    decodedPosterUrl = decodeURIComponent(presentationLine.slice("poster=".length));
  } catch {
    return null;
  }
  const posterUrl = normalizePosterUrl(decodedPosterUrl);
  return posterUrl ? { ...parsed, presentation: { posterUrl } } : null;
}

export function encodePlaybackTargetShortCode(
  ref: PlaybackTargetRef,
  action: KunaiShareAction = "play",
): string | null {
  if (ref.anchor.by !== "catalog") return null;
  const token = `${SHORT_CODE_PREFIX}${ACTION_TO_CODE[action]}${NS_TO_CODE[ref.anchor.ns]}${KIND_TO_CODE[ref.kind]}`;
  const fields = [
    encodeCompactCatalogId(ref.anchor.id),
    encodeCompactInt(ref.season),
    encodeCompactInt(ref.episode),
    encodeCompactInt(ref.absoluteEpisode),
    encodeCompactInt(ref.startSeconds),
    encodeOptionalCompactText(ref.hint?.providerId),
    encodeOptionalCompactText(ref.hint?.quality),
    encodeOptionalCompactText(ref.title),
  ];
  while (fields.at(-1) === "_") fields.pop();
  const body = `${token}.${fields.join(".")}`;
  return `${body}.${compactChecksum(body)}`;
}

export function parsePlaybackTargetRef(raw: string): PlaybackTargetRef | null {
  return parseKunaiShareUrl(raw)?.ref ?? null;
}

export function parseKunaiShareUrl(raw: string): ParsedKunaiShare | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith(SHORT_CODE_PREFIX)) return parseCompactShareCode(value);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "kunai:") return parseKunaiProtocolUrl(value);
  if (url.origin !== KUNAI_WEB_SHARE_ORIGIN || url.search || url.hash) return null;
  const match = /^\/w\/([^/]+)$/.exec(url.pathname);
  return match?.[1] ? decodePlaybackTargetWebCode(match[1]) : null;
}

export function resolveShareAction(url: URL): KunaiShareAction | null {
  const hostAction = normalizeToken(url.hostname);
  if (hostAction === "play" || hostAction === "download") return hostAction;
  const pathAction = normalizeToken(url.pathname.split("/").find(Boolean) ?? null);
  if (pathAction === "play" || pathAction === "download") return pathAction;
  return null;
}

function normalizePosterUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || value.length > MAX_POSTER_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function webPayloadFits(payload: string): boolean {
  const payloadBytes = new TextEncoder().encode(payload);
  if (payloadBytes.length > MAX_DECODED_PAYLOAD_BYTES) return false;
  const encodedLength = WEB_CODE_PREFIX.length + Math.ceil((payloadBytes.length + 4) / 3) * 4;
  return encodedLength <= MAX_WEB_CODE_LENGTH;
}

function encodePlaybackTargetQuery(ref: PlaybackTargetRef): string {
  const params = new URLSearchParams();
  if (ref.anchor.by === "catalog") {
    params.set("cat", `${ref.anchor.ns}:${ref.anchor.id}`);
  } else {
    params.set("q", ref.anchor.query);
  }
  params.set("kind", ref.kind);
  if (typeof ref.season === "number") params.set("s", String(ref.season));
  if (typeof ref.episode === "number") params.set("e", String(ref.episode));
  if (typeof ref.absoluteEpisode === "number") params.set("abs", String(ref.absoluteEpisode));
  if (typeof ref.startSeconds === "number") {
    params.set("t", formatSecondsForUrl(ref.startSeconds));
  }
  if (ref.hint?.providerId) params.set("src", ref.hint.providerId);
  if (ref.hint?.quality) params.set("sq", ref.hint.quality);
  if (ref.title) params.set("n", ref.title);
  return PARAM_ORDER.filter((key) => params.has(key))
    .map((key) => `${key}=${encodeURIComponent(params.get(key) as string)}`)
    .join("&");
}

function parseKunaiProtocolUrl(value: string): ParsedKunaiShare | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "kunai:") return null;
  const action = resolveShareAction(url);
  const anchor = readAnchor(url.searchParams);
  if (!action || !anchor) return null;

  const kind = readKind(url.searchParams);
  const season = readInt(url.searchParams.get("s"));
  const episode = readInt(url.searchParams.get("e"));
  const absoluteEpisode = readInt(url.searchParams.get("abs"));
  const startSeconds = parseTimestampToSeconds(url.searchParams.get("t"));
  const src = url.searchParams.get("src")?.trim();
  const quality = url.searchParams.get("sq")?.trim();
  const title = url.searchParams.get("n")?.trim();

  return {
    action,
    ref: {
      anchor,
      kind,
      ...(season !== null ? { season } : {}),
      ...(episode !== null ? { episode } : {}),
      ...(absoluteEpisode !== null ? { absoluteEpisode } : {}),
      ...(startSeconds !== null ? { startSeconds } : {}),
      ...(src ? { hint: { providerId: src, ...(quality ? { quality } : {}) } } : {}),
      ...(title ? { title } : {}),
    },
  };
}

function parseCompactShareCode(value: string): ParsedKunaiShare | null {
  if (value.length > MAX_SHORT_CODE_LENGTH) return null;
  const parts = value.split(".");
  const checksum = parts.pop();
  const body = parts.join(".");
  if (!checksum || checksum !== compactChecksum(body)) return null;
  const [token, ...rawFields] = parts;
  const tokenMatch = /^k1([pd])([tamiy])([msav])$/.exec(token ?? "");
  if (!tokenMatch || rawFields.length < 1 || rawFields.length > 8) return null;
  while (rawFields.length < 8) rawFields.push("_");

  const action = CODE_TO_ACTION[tokenMatch[1] as keyof typeof CODE_TO_ACTION];
  const ns = CODE_TO_NS[tokenMatch[2] as keyof typeof CODE_TO_NS];
  const kind = CODE_TO_KIND[tokenMatch[3] as keyof typeof CODE_TO_KIND];
  const id = decodeCompactCatalogId(rawFields[0] ?? "");
  const season = decodeCompactInt(rawFields[1] ?? "_");
  const episode = decodeCompactInt(rawFields[2] ?? "_");
  const absoluteEpisode = decodeCompactInt(rawFields[3] ?? "_");
  const startSeconds = decodeCompactInt(rawFields[4] ?? "_");
  const providerId = decodeOptionalCompactText(rawFields[5] ?? "_");
  const quality = decodeOptionalCompactText(rawFields[6] ?? "_");
  const title = decodeOptionalCompactText(rawFields[7] ?? "_");

  if (
    !action ||
    !ns ||
    !kind ||
    !id ||
    season === false ||
    episode === false ||
    absoluteEpisode === false ||
    startSeconds === false ||
    providerId === false ||
    quality === false ||
    title === false
  ) {
    return null;
  }

  return {
    action,
    ref: {
      anchor: { by: "catalog", ns, id },
      kind,
      ...(season !== null ? { season } : {}),
      ...(episode !== null ? { episode } : {}),
      ...(absoluteEpisode !== null ? { absoluteEpisode } : {}),
      ...(startSeconds !== null ? { startSeconds } : {}),
      ...(providerId ? { hint: { providerId, ...(quality ? { quality } : {}) } } : {}),
      ...(title ? { title } : {}),
    },
  };
}

function readAnchor(params: URLSearchParams): ShareAnchor | null {
  const cat = params.get("cat")?.trim();
  if (cat) {
    const colon = cat.indexOf(":");
    if (colon <= 0) return null;
    const ns = cat.slice(0, colon).trim();
    const id = cat.slice(colon + 1).trim();
    if (!CATALOG_NS.has(ns) || !id) return null;
    return { by: "catalog", ns: ns as CatalogNs, id };
  }
  const query = params.get("q")?.trim();
  if (query) return { by: "search", query: query.slice(0, 200) };
  return null;
}

function readKind(params: URLSearchParams): PlaybackTargetRef["kind"] {
  const explicit = params.get("kind")?.trim();
  if (
    explicit === "movie" ||
    explicit === "series" ||
    explicit === "anime" ||
    explicit === "video"
  ) {
    return explicit;
  }
  return "series";
}

function readInt(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeToken(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

function encodeCompactInt(value: number | undefined): string {
  if (value === undefined) return "_";
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Compact share numbers must be non-negative safe integers");
  }
  return value.toString(36);
}

function decodeCompactInt(value: string): number | null | false {
  if (value === "_") return null;
  if (!/^[0-9a-z]+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 36);
  return Number.isSafeInteger(parsed) ? parsed : false;
}

function encodeOptionalCompactText(value: string | undefined): string {
  return value ? encodeCompactText(value) : "_";
}

function encodeCompactCatalogId(value: string): string {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return `~${encodeCompactText(value)}`;
}

function decodeCompactCatalogId(value: string): string | null {
  if (/^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return value.startsWith("~") ? decodeCompactText(value.slice(1)) : null;
}

function decodeOptionalCompactText(value: string): string | null | false {
  return value === "_" ? null : decodeCompactText(value) || false;
}

function encodeCompactText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length === 0 || bytes.length > MAX_COMPACT_TEXT_BYTES) {
    throw new RangeError("Compact share text is empty or too long");
  }
  return encodeBase64Url(bytes);
}

function decodeCompactText(value: string): string | null {
  const bytes = decodeBase64Url(value);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_COMPACT_TEXT_BYTES) return null;
  return decodeUtf8(bytes);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      output += BASE64URL_ALPHABET[(buffer >>> bitCount) & 0x3f] ?? "";
    }
    buffer &= (1 << bitCount) - 1;
  }
  if (bitCount > 0) {
    output += BASE64URL_ALPHABET[(buffer << (6 - bitCount)) & 0x3f] ?? "";
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes: number[] = [];
  let buffer = 0;
  let bitCount = 0;
  for (const character of value) {
    const index = BASE64URL_ALPHABET.indexOf(character);
    if (index < 0) return null;
    buffer = (buffer << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >>> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (buffer !== 0) return null;
  const decoded = Uint8Array.from(bytes);
  return encodeBase64Url(decoded) === value ? decoded : null;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function compactChecksum(value: string): string {
  return crc32(new TextEncoder().encode(value)).toString(36);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
