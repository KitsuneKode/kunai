// =============================================================================
// strip-html.ts — turn catalog HTML leftovers into readable plain text.
//
// AniList `description(asHtml: false)` still emits `<br>` / `<i>` fragments.
// Stripping only `<>` left tag names in the synopsis (`iPart 1…/i brbr`).
//
// Two things make the naive version wrong, and both were live here:
//
// 1. Chained `.replace()` calls for entities re-read their own output, so
//    `&amp;lt;` decoded to `&lt;` and then to `<` — text the source escaped
//    precisely so it would not become markup. One pass with a replacer
//    function fixes it: scanning resumes after each match, never inside it.
// 2. A single tag-strip is not enough even after decoding, because a stripped
//    tag can join its neighbours into a new one (`<scr<script>ipt>`). The
//    strip has to run to a fixed point.
//
// Output is terminal prose, never a DOM, so this is about not printing markup
// rather than about XSS. It is written to satisfy the stricter reading anyway:
// a sanitizer that is only correct in its current caller invites the next one.
// =============================================================================

// `[^<>]*` rather than `[^>]*`: the permissive form lets a match run across a
// nested `<`, so `<scr<foo>ipt>` is eaten in one greedy bite that leaves the
// inert-but-wrong `ipt>` behind. Stopping at the inner `<` removes `<foo>`,
// which joins the halves into `<script>` — which is exactly what the
// fixed-point loop below is for.
const TAG = /<\/?[^<>]*>/g;
const BREAK = /<br\s*\/?\s*>/gi;

/** Every entity is resolved in one pass; see note 1 above. */
const ENTITY = /&(nbsp|amp|lt|gt|quot|apos|#0*39|#x0*27);/gi;

const ENTITY_TEXT: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntity(name: string): string {
  const key = name.toLowerCase();
  if (key.startsWith("#")) return "'";
  return ENTITY_TEXT[key] ?? "";
}

/**
 * Strip tags until the text stops changing.
 *
 * Each pass removes at least one character or changes nothing, so this always
 * terminates; the bound is belt-and-braces against a future `TAG` edit that
 * could match empty.
 */
function stripTags(value: string): string {
  let current = value;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(TAG, "");
    if (next === current) return current;
    current = next;
  }
  return current;
}

export function stripHtml(value: string): string {
  const withoutTags = stripTags(value.replace(BREAK, " "));
  const decoded = withoutTags.replace(ENTITY, (_match, name: string) => decodeEntity(name));
  // Decoding can reveal a second layer of markup, so strip again — but do not
  // decode again, or note 1 comes straight back.
  return stripTags(decoded).replace(/\s+/g, " ").trim();
}
