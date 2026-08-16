// =============================================================================
// strip-html.ts — turn catalog HTML leftovers into readable plain text.
//
// AniList `description(asHtml: false)` still emits `<br>` / `<i>` fragments.
// Stripping only `<>` left tag names in the synopsis (`iPart 1…/i brbr`).
// =============================================================================

const TAG = /<\/?[^>]+>/g;
const BREAK = /<br\s*\/?\s*>/gi;

export function stripHtml(value: string): string {
  return (
    value
      .replace(BREAK, " ")
      .replace(TAG, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      // Entity decoding can reveal a second layer of markup. Strip again so
      // catalog prose never recreates an HTML tag after sanitization.
      .replace(TAG, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}
