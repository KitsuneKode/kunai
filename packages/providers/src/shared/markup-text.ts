// =============================================================================
// markup-text.ts — turning fetched provider markup into text that is safe to
// print to a terminal.
//
// Every helper here exists because the naive one-liner is wrong in a way that
// only shows up on hostile or malformed input: a regex that degrades to
// quadratic time, a tag strip that leaves `<script` behind, an entity decoder
// that mints a raw ESC byte into a string headed for stdout. Scraped HTML and
// scraped XML have the same problem, so they share one implementation.
// =============================================================================

/**
 * Removes `<script>…</script>` spans by scanning, not by regex.
 *
 * `/<script\b[\s\S]*?<\/script(?:[\s/][^>]*)?>/` is polynomial: the lazy body
 * advances one character at a time and each position re-scans `[^>]*` to the end,
 * so input repeating `</script\t` with no `>` degrades quadratically. This runs on
 * fetched provider markup, so that is a denial-of-service vector, not a nicety.
 *
 * Tag-name boundaries follow HTML: a name ends at whitespace, `/`, or `>`, and the
 * rest of an end tag is ignored — `</script>`, `</script >`, `</script\t\n bar>`
 * and `</script/>` all close, `</scriptfoo>` does not. An unterminated `<script`
 * drops the remainder: leaving it would put raw script source in a title.
 */
export function stripScriptBlocks(body: string): string {
  const lowered = body.toLowerCase();
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = indexOfTag(lowered, "<script", cursor);
    if (open === -1) return out + body.slice(cursor);
    const openEnd = body.indexOf(">", open);
    if (openEnd === -1) return `${out + body.slice(cursor, open)} `;
    const close = indexOfTag(lowered, "</script", openEnd + 1);
    if (close === -1) return `${out + body.slice(cursor, open)} `;
    const closeEnd = body.indexOf(">", close);
    if (closeEnd === -1) return `${out + body.slice(cursor, open)} `;
    out += `${body.slice(cursor, open)} `;
    cursor = closeEnd + 1;
  }
}

/**
 * Replaces `/<[^>]+>/g` for the same reason as stripScriptBlocks: on a body of
 * many `<` with no `>`, every `<` restarts a scan to end of input. Here the
 * failing `indexOf(">")` can happen at most once, because it returns
 * immediately, so the walk stays linear.
 *
 * Faithful to the regex it replaces: a tag needs at least one character between
 * the brackets, so a literal `<>` is text, and an unclosed `<` keeps the rest of
 * the string as text rather than discarding it.
 *
 * Run it after `stripScriptBlocks`, never instead of it: one pass over
 * `<<script>script>alert(1)</script>` leaves a live `<script` behind.
 */
export function stripTags(value: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = value.indexOf("<", cursor);
    if (open === -1) return out + value.slice(cursor);
    const close = value.indexOf(">", open + 1);
    if (close === -1) return out + value.slice(cursor);
    if (close === open + 1) {
      out += value.slice(cursor, close + 1);
      cursor = close + 1;
      continue;
    }
    out += `${value.slice(cursor, open)} `;
    cursor = close + 1;
  }
}

/** `indexOf` for a tag whose name ends at the match — not `<scriptfoo>`. */
function indexOfTag(lowered: string, tag: string, from: number): number {
  for (
    let index = lowered.indexOf(tag, from);
    index !== -1;
    index = lowered.indexOf(tag, index + 1)
  ) {
    const next = lowered.charCodeAt(index + tag.length);
    // whitespace, `/`, `>`, or end of input all terminate the tag name.
    if (Number.isNaN(next) || next === 0x2f || next === 0x3e || next <= 0x20) return index;
  }
  return -1;
}

/**
 * Drops C0/C1 controls but keeps tab/LF/CR, which a whitespace collapse then
 * turns into a single space -- stripping them outright would weld "Foo\nBar"
 * into "FooBar". Written as a code-point scan rather than a regex: a character
 * class of raw control characters is exactly what `no-control-regex` forbids,
 * and the scan reuses the same predicate the entity decoder checks.
 */
export function stripControlCharacters(value: string): string {
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isCollapsibleWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    if (isControlCodePoint(codePoint) && !isCollapsibleWhitespace) continue;
    out += character;
  }
  return out;
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

/**
 * Single pass, so `&amp;lt;` decodes to the literal `&lt;` and never to `<`.
 *
 * The five named entities are the XML predefined set, which is also the subset
 * that matters in scraped HTML titles, so HTML and XML share this decoder.
 */
export function decodeMarkupEntities(value: string): string {
  return value.replace(
    HTML_ENTITY_PATTERN,
    (raw: string, hex?: string, decimal?: string, named?: string) => {
      if (hex !== undefined) return decodeCodePoint(raw, Number.parseInt(hex, 16));
      if (decimal !== undefined) return decodeCodePoint(raw, Number.parseInt(decimal, 10));
      return NAMED_ENTITIES[named?.toLowerCase() ?? ""] ?? raw;
    },
  );
}

/**
 * The whole pipeline for one field of scraped markup: no scripts, no tags, no
 * smuggled control characters, entities decoded exactly once, whitespace
 * collapsed. Anything printed to the terminal from a provider response should
 * come through here.
 */
export function markupToPlainText(value: string): string {
  const decoded = decodeMarkupEntities(stripTags(stripScriptBlocks(value)));
  // A raw ESC/BEL byte in the response body is the other half of the entity
  // vector closed in decodeCodePoint(); `\s` matches neither, so without this
  // they would survive into terminal output.
  return stripControlCharacters(decoded).replace(/\s+/g, " ").trim();
}
