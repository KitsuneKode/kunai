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
  const normalizedTitle = decodeHtmlEntities(title).replace(/\s+/g, " ").trim();
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
    results.push({ id, title, numericId, seasonEvidence: parseAnidbSeasonEvidence(title) });
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
): AnidbSearchResult | null {
  const first = results[0] ?? null;
  const normalizedQuery = normalizeTitle(query);
  if (!first || !normalizedQuery) return first;

  const exact = results.find((result) => normalizeTitle(result.title) === normalizedQuery);
  if (exact) return exact;

  const prefixed = results.find((result) => {
    const normalizedTitle = normalizeTitle(result.title);
    return (
      normalizedTitle.startsWith(`${normalizedQuery} `) ||
      normalizedQuery.startsWith(`${normalizedTitle} `)
    );
  });
  return prefixed ?? first;
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
  const decoded = decodeHtmlEntities(href ?? "").trim();
  const match = /^(?:(?:https?:)?\/\/anidb\.app)?\/anime\/([^/?#]+)(?:[/?#].*)?$/i.exec(decoded);
  const id = (match?.[1] ?? "").trim();
  return looksLikeAnidbShowId(id) ? id : null;
}

function extractAnidbTitle(attrs: string, body: string): string {
  const anchorTitle = extractAttribute(attrs, "title") ?? extractAttribute(attrs, "aria-label");
  const imageAlt = IMAGE_ALT_PATTERN.exec(body)?.[1];
  const nestedText = body.replace(SCRIPT_BLOCK_PATTERN, " ").replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(anchorTitle ?? imageAlt ?? nestedText);
  // A raw ESC/BEL byte in the response body is the other half of the entity
  // vector closed in decodeCodePoint(); `\s` matches neither, so without this
  // they would survive into terminal output.
  return stripControlCharacters(decoded).replace(/\s+/g, " ").trim();
}

/**
 * Drops C0/C1 controls but keeps tab/LF/CR, which the whitespace collapse below
 * turns into a single space -- stripping them outright would weld "Foo\nBar"
 * into "FooBar". Written as a code-point scan rather than a regex: a character
 * class of raw control characters is exactly what `no-control-regex` forbids,
 * and the scan reuses the same predicate the entity decoder checks.
 */
function stripControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isCollapsibleWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    if (isControlCodePoint(codePoint) && !isCollapsibleWhitespace) continue;
    out += character;
  }
  return out;
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

/**
 * An HTML end tag's name ends at whitespace, `/`, or `>`, and anything up to the
 * `>` is then ignored — so `</script>`, `</script >`, `</script\t\n bar>` and
 * `</script/>` all close a script, while `</scriptfoo>` does not. Matching only
 * `</script>` (or only `</script\s*>`) leaves script source in the anchor body,
 * where it becomes the title.
 */
const SCRIPT_BLOCK_PATTERN = /<script\b[\s\S]*?<\/script(?:[\s/][^>]*)?>/gi;

function extractAttribute(
  attrs: string,
  name: keyof typeof ATTRIBUTE_PATTERNS,
): string | undefined {
  const value = ATTRIBUTE_PATTERNS[name].exec(attrs)?.[1];
  return value?.trim() ? value : undefined;
}

const HTML_ENTITY_PATTERN = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeCodePoint(raw: string, codePoint: number): string {
  // Reject out-of-range values and the lone-surrogate block, which would
  // otherwise produce an ill-formed title string.
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return raw;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return raw;
  // Refuse to manufacture control characters. `&#27;` is plain ASCII in the
  // response body, so a provider needs no raw ESC byte to smuggle one -- the
  // decoder would mint it. These titles are printed straight to a terminal,
  // where ESC drives cursor movement, screen clears, and OSC 52 clipboard
  // writes. C0 (0x00-0x1f, 0x7f) and C1 (0x80-0x9f) are left as inert text.
  if (isControlCodePoint(codePoint)) return raw;
  return String.fromCodePoint(codePoint);
}

function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** Single pass, so `&amp;lt;` decodes to the literal `&lt;` and never to `<`. */
function decodeHtmlEntities(value: string): string {
  return value.replace(
    HTML_ENTITY_PATTERN,
    (raw: string, hex?: string, decimal?: string, named?: string) => {
      if (hex !== undefined) return decodeCodePoint(raw, Number.parseInt(hex, 16));
      if (decimal !== undefined) return decodeCodePoint(raw, Number.parseInt(decimal, 10));
      return NAMED_ENTITIES[named?.toLowerCase() ?? ""] ?? raw;
    },
  );
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
