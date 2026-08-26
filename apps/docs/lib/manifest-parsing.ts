/**
 * Manifest value parsing for the docs codegen.
 *
 * Lives beside the generated output rather than inside `sync-code-metadata.ts`
 * so it can be tested without pulling the CLI source (and its `@/` path
 * aliases) into the docs TypeScript program. These are pure string functions.
 */

/** Read a single quoted manifest value, honouring apostrophes inside it. */
export function extractString(content: string, prop: string): string | null {
  const start = findPropertyValueStart(content, prop);
  if (start < 0) return null;
  const literal = readStringLiteral(content, start);
  return literal ? literal.value : null;
}

export function extractBoolean(content: string, prop: string): boolean {
  const regex = new RegExp(`${prop}:\\s*(true|false)`);
  const match = content.match(regex);
  return match ? match[1] === "true" : false;
}

/**
 * Reads a manifest array as a list of string literals.
 *
 * Splitting the array body on `,` and stripping every quote — which is what
 * this did — corrupts ordinary prose silently: a comma inside a note split it
 * into two docs bullets, an apostrophe was deleted from the middle of a word,
 * and a `]` inside a note truncated it and dropped every entry after it. None
 * of that failed loudly; it just shipped to the public docs site. So the body
 * is scanned for string literals instead, and everything between them —
 * commas, whitespace, a trailing comma — is separator that never reaches the
 * value.
 */
export function extractArray(content: string, prop: string): string[] {
  const start = findPropertyValueStart(content, prop);
  if (start < 0 || content[start] !== "[") return [];

  const values: string[] = [];
  let index = start + 1;
  let depth = 1;
  while (index < content.length && depth > 0) {
    const char = content[index];
    if (char === undefined) break;
    if (QUOTES.has(char)) {
      const literal = readStringLiteral(content, index);
      if (!literal) break;
      values.push(literal.value);
      index = literal.endIndex;
      continue;
    }
    // Brackets are tracked so a nested array ends the scan at the right place
    // rather than at the first `]` the regex happened to reach.
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    index += 1;
  }

  return values.filter((value) => value.length > 0);
}

const QUOTES = new Set(['"', "'", "`"]);

/**
 * Index of the first non-space character after `prop:`, or -1.
 *
 * The leading boundary check stops `notes` from matching the tail of a longer
 * identifier such as `releaseNotes`.
 */
function findPropertyValueStart(content: string, prop: string): number {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${prop}\\s*:\\s*`);
  const match = pattern.exec(content);
  if (!match) return -1;
  return match.index + match[0].length;
}

/** Parse one quoted literal, honouring backslash escapes. */
function readStringLiteral(
  content: string,
  start: number,
): { readonly value: string; readonly endIndex: number } | null {
  const quote = content[start];
  if (quote === undefined || !QUOTES.has(quote)) return null;

  let value = "";
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === undefined) break;
    if (char === "\\") {
      const escaped = content[index + 1];
      if (escaped === undefined) break;
      value += unescapeChar(escaped);
      index += 2;
      continue;
    }
    if (char === quote) return { value, endIndex: index + 1 };
    value += char;
    index += 1;
  }
  return null;
}

function unescapeChar(char: string): string {
  if (char === "n") return "\n";
  if (char === "t") return "\t";
  if (char === "r") return "\r";
  return char;
}
