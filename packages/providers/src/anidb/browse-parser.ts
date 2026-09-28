import { decodeMarkupEntities, markupToPlainText, stripScriptBlocks } from "../shared/markup-text";

/**
 * Pure AniDB browse-markup parsing.
 *
 * anidb.app has shipped two card generations: legacy relative `/anime/<slug-id>`
 * anchors whose title only exists in the nested image `alt`, and current absolute
 * `https://anidb.app/anime/<slug-id>` anchors that carry the title on the anchor
 * itself. Both must survive one parser so search and resolve cannot drift apart.
 *
 * The parser captures the complete anchor opening tag first and only then parses
 * `href` out of those attributes. Making href matching also delimit the attribute
 * text is what previously let a `title` placed after `href` be lost.
 */

export interface AnidbSeasonEvidence {
  readonly seasonNumber: number | null;
  readonly label: string | null;
  readonly normalizedBaseTitle: string;
}

export interface AnidbSearchResult {
  readonly id: string;
  readonly title: string;
  readonly numericId: number;
  readonly posterUrl?: string;
  readonly rating?: number;
  /** Present only when the card badge is Movie. Everything else stays a series. */
  readonly kind?: "movie";
  readonly seasonEvidence: AnidbSeasonEvidence;
}

/** `slug-1234` show ids used by anidb.app / ani-cli. The suffix must be positive. */
export function looksLikeAnidbShowId(value: string | undefined): value is string {
  if (!value?.trim()) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/i.test(value.trim()) && anidbNumericId(value) !== null;
}

export function anidbNumericId(showId: string): number | null {
  const match = /-(\d+)$/.exec(showId.trim());
  if (!match?.[1]) return null;
  const numeric = Number(match[1]);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export function parseAnidbSeasonEvidence(title: string): AnidbSeasonEvidence {
  const normalizedTitle = decodeMarkupEntities(title).replace(/\s+/g, " ").trim();
  const match =
    /\bseason\s+(\d+)\b/i.exec(normalizedTitle) ??
    /\b(\d+)(?:st|nd|rd|th)\s+season\b/i.exec(normalizedTitle) ??
    /\bs(\d+)\b/i.exec(normalizedTitle);
  const seasonNumber = Number(match?.[1]);
  const validSeason = Number.isInteger(seasonNumber) && seasonNumber > 0 ? seasonNumber : null;
  const label = validSeason === null ? null : (match?.[0] ?? null);
  const baseTitle =
    match && validSeason !== null
      ? `${normalizedTitle.slice(0, match.index)} ${normalizedTitle.slice(match.index + match[0].length)}`
      : normalizedTitle;
  return {
    seasonNumber: validSeason,
    label,
    normalizedBaseTitle: normalizeTitle(baseTitle),
  };
}

export function parseAnidbBrowseHtml(html: string): readonly AnidbSearchResult[] {
  // Instantiated per call: a shared /g/ regex would carry `lastIndex` between calls.
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const results: AnidbSearchResult[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const id = parseAnidbShowIdFromHref(extractAttribute(attrs, "href"));
    if (!id || seen.has(id) || !hasResultCardEvidence(attrs, body)) continue;
    const title = extractAnidbTitle(attrs, body);
    const numericId = anidbNumericId(id);
    if (!title || numericId === null) continue;
    seen.add(id);
    const card = extractAnidbCardFields(body, title);
    results.push({
      id,
      title,
      numericId,
      ...(card.posterUrl ? { posterUrl: card.posterUrl } : {}),
      ...(card.rating !== undefined ? { rating: card.rating } : {}),
      ...(card.kind === "movie" ? { kind: "movie" as const } : {}),
      seasonEvidence: parseAnidbSeasonEvidence(title),
    });
  }
  return results;
}

/**
 * Pick the result a query actually asked for instead of trusting document order.
 *
 * `parseAnidbBrowseHtml` already drops page chrome, but a "related"/"you may also
 * like" card is structurally identical to a result card, so document order alone
 * is not safe to resolve against.
 */
export function chooseAnidbSearchMatch(
  query: string,
  results: readonly AnidbSearchResult[],
  options: {
    /**
     * Drop the "best guess is the first card" fallback and return `null` when
     * no title actually matches.
     *
     * A user who typed a query is well served by the top card even on a weak
     * match — they can see what they got. Code repairing a *persisted* id has
     * no such reader: substituting the first search result there swaps the show
     * the user previously chose for an unrelated one, silently.
     */
    readonly requireTitleEvidence?: boolean;
  } = {},
): AnidbSearchResult | null {
  const strict = options.requireTitleEvidence === true;
  const fallback = strict ? null : (results[0] ?? null);
  const normalizedQuery = normalizeTitle(query);
  if (results.length === 0 || !normalizedQuery) return fallback;

  const exact = results.find((result) => normalizeTitle(result.title) === normalizedQuery);
  if (exact) return exact;

  const prefixed = results.find((result) => {
    const normalizedTitle = normalizeTitle(result.title);
    return (
      normalizedTitle.startsWith(`${normalizedQuery} `) ||
      normalizedQuery.startsWith(`${normalizedTitle} `)
    );
  });
  return prefixed ?? fallback;
}

/**
 * A result card is an anchor that labels itself (`title` / `aria-label`) or wraps
 * nested card markup. Nav, breadcrumb, related-rail and footer links to
 * `/anime/<slug-id>` are bare text anchors and carry neither, so they never enter
 * the result set — which matters because resolve picks from these results.
 *
 * This deliberately keys on structure rather than a container class name; class
 * names are exactly what breaks on the next anidb.app reskin.
 */
function hasResultCardEvidence(attrs: string, body: string): boolean {
  if (extractAttribute(attrs, "title") ?? extractAttribute(attrs, "aria-label")) return true;
  return hasNestedElement(body);
}

/**
 * Scanned rather than matched with `/<[a-z][^>]*>/`. That pattern is quadratic on
 * input like `<a<a<a…` with no `>` — every `<a` restarts a scan to end of input —
 * and this runs on fetched provider markup we do not control. Walking `<` offsets
 * against one precomputed last `>` is linear and answers the same question.
 */
function hasNestedElement(body: string): boolean {
  const lastClose = body.lastIndexOf(">");
  if (lastClose < 2) return false;
  for (
    let index = body.indexOf("<");
    index !== -1 && index < lastClose;
    index = body.indexOf("<", index + 1)
  ) {
    const code = body.charCodeAt(index + 1);
    const startsTagName = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (startsTagName) return true;
  }
  return false;
}

function parseAnidbShowIdFromHref(href: string | undefined): string | null {
  const decoded = decodeMarkupEntities(href ?? "").trim();
  const match = /^(?:(?:https?:)?\/\/anidb\.app)?\/anime\/([^/?#]+)(?:[/?#].*)?$/i.exec(decoded);
  const id = (match?.[1] ?? "").trim();
  return looksLikeAnidbShowId(id) ? id : null;
}

function extractAnidbTitle(attrs: string, body: string): string {
  const anchorTitle = extractAttribute(attrs, "title") ?? extractAttribute(attrs, "aria-label");
  const imageAlt = IMAGE_ALT_PATTERN.exec(body)?.[1];
  return markupToPlainText(anchorTitle ?? imageAlt ?? stripScriptBlocks(body));
}

function extractAnidbCardFields(
  body: string,
  title: string,
): {
  readonly posterUrl?: string;
  readonly rating?: number;
  readonly kind?: "movie";
} {
  const remainder = stripTitleFromCardText(markupToPlainText(body), title);
  const ratingMatch = remainder.match(/\b(10(?:\.0)?|[0-9]\.[0-9])\b/);
  const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
  return {
    posterUrl: extractAnidbPosterUrl(body),
    ...(rating !== undefined && Number.isFinite(rating) ? { rating } : {}),
    ...(/\bmovie\b/i.test(remainder) ? { kind: "movie" as const } : {}),
  };
}

function extractAnidbPosterUrl(body: string): string | undefined {
  const raw = IMAGE_SRC_PATTERN.exec(body)?.[1];
  if (!raw) return undefined;
  try {
    const parsed = new URL(decodeMarkupEntities(raw).trim(), "https://anidb.app/");
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.pathname.toLowerCase().endsWith("placeholder.svg")) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function stripTitleFromCardText(plain: string, title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return plain;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return plain.replace(new RegExp(escaped, "gi"), " ").replace(/\s+/g, " ").trim();
}

/**
 * Attribute patterns are precompiled and anchored on a start-or-whitespace
 * boundary. A `\b` boundary also matches after `-` and `:`, which would let
 * `data-href` / `xlink:href` / `data-original-title` shadow the real attribute
 * and pin the wrong AniDB show id.
 */
const ATTRIBUTE_PATTERNS = {
  href: /(?:^|\s)href\s*=\s*["']([^"']*)["']/i,
  title: /(?:^|\s)title\s*=\s*["']([^"']*)["']/i,
  "aria-label": /(?:^|\s)aria-label\s*=\s*["']([^"']*)["']/i,
} as const;

const IMAGE_ALT_PATTERN = /<img\b[^>]*\salt\s*=\s*["']([^"']*)["']/i;
const IMAGE_SRC_PATTERN = /<img\b[^>]*\ssrc\s*=\s*["']([^"']*)["']/i;

function extractAttribute(
  attrs: string,
  name: keyof typeof ATTRIBUTE_PATTERNS,
): string | undefined {
  const value = ATTRIBUTE_PATTERNS[name].exec(attrs)?.[1];
  return value?.trim() ? value : undefined;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
