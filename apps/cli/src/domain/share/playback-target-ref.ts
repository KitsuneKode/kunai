// =============================================================================
// playback-target-ref.ts — portable catalog-anchored "what to play" model + codec.
// =============================================================================

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

const CATALOG_NS: ReadonlySet<string> = new Set(["tmdb", "anilist", "mal", "imdb", "youtube"]);
const PARAM_ORDER = ["cat", "q", "kind", "s", "e", "abs", "t", "src", "sq", "n"] as const;

export function parseTimestampToSeconds(raw: string | null | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const seconds = Number.parseInt(value, 10);
    return seconds >= 0 ? seconds : null;
  }
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(value);
  if (clock) {
    const h = clock[1] ? Number.parseInt(clock[1], 10) : 0;
    const m = Number.parseInt(clock[2] ?? "", 10);
    const s = Number.parseInt(clock[3] ?? "", 10);
    if (m > 59 || s > 59) return null;
    const total = h * 3600 + m * 60 + s;
    return total >= 0 ? total : null;
  }
  const human = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (human && (human[1] || human[2] || human[3])) {
    const h = human[1] ? Number.parseInt(human[1], 10) : 0;
    const m = human[2] ? Number.parseInt(human[2], 10) : 0;
    const s = human[3] ? Number.parseInt(human[3], 10) : 0;
    const total = h * 3600 + m * 60 + s;
    return total >= 0 ? total : null;
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
  const ordered = PARAM_ORDER.filter((key) => params.has(key))
    .map((key) => `${key}=${encodeURIComponent(params.get(key) as string)}`)
    .join("&");
  return `kunai://${action}?${ordered}`;
}

export function parsePlaybackTargetRef(raw: string): PlaybackTargetRef | null {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "kunai:") return null;

  const anchor = readAnchor(url.searchParams);
  if (!anchor) return null;

  const kind = readKind(url.searchParams);
  const season = readInt(url.searchParams.get("s"));
  const episode = readInt(url.searchParams.get("e"));
  const absoluteEpisode = readInt(url.searchParams.get("abs"));
  const startSeconds = parseTimestampToSeconds(url.searchParams.get("t"));
  const src = url.searchParams.get("src")?.trim();
  const quality = url.searchParams.get("sq")?.trim();
  const title = url.searchParams.get("n")?.trim();

  return {
    anchor,
    kind,
    ...(season !== null ? { season } : {}),
    ...(episode !== null ? { episode } : {}),
    ...(absoluteEpisode !== null ? { absoluteEpisode } : {}),
    ...(startSeconds !== null ? { startSeconds } : {}),
    ...(src ? { hint: { providerId: src, ...(quality ? { quality } : {}) } } : {}),
    ...(title ? { title } : {}),
  };
}

export function parseKunaiShareUrl(
  raw: string,
): { readonly action: KunaiShareAction; readonly ref: PlaybackTargetRef } | null {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "kunai:") return null;
  const action = resolveShareAction(url);
  if (!action) return null;
  const ref = parsePlaybackTargetRef(value);
  if (!ref) return null;
  return { action, ref };
}

export function resolveShareAction(url: URL): KunaiShareAction | null {
  const hostAction = normalizeToken(url.hostname);
  if (hostAction === "play" || hostAction === "download") return hostAction;
  const pathAction = normalizeToken(url.pathname.split("/").find(Boolean) ?? null);
  if (pathAction === "play" || pathAction === "download") return pathAction;
  return null;
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
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeToken(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}
