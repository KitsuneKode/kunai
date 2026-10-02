// This module runs on bare JavaScriptCore in a-Shell, which exposes no Web API
// globals. URL parsing and canonicalization here are hand-rolled: new URL()
// exists only on the Android/Node runtime.

const HTTPS_PREFIX = "https://";
const HTTPS_PREFIX_PATTERN = /^https:\/\//iu;

// WHATWG percent-encode sets for a special scheme (https): the path set is the
// query set plus `?` `^` `` ` `` `{` `}`; the special-scheme query set adds `'`.
// `?` and `#` cannot appear by construction (query split precedes encoding and
// `#` is rejected as a fragment marker before parsing).
const PATH_ENCODE_ASCII = new Set([" ", '"', "<", ">", "^", "`", "{", "}"]);
const QUERY_ENCODE_ASCII = new Set([" ", '"', "<", ">", "'"]);

// Characters forbidden in an authority host (outside a bracketed IPv6 literal).
const HOST_FORBIDDEN_ASCII = new Set([
  " ",
  '"',
  "#",
  "/",
  "<",
  ">",
  "?",
  "@",
  "[",
  "]",
  "\\",
  "^",
  "|",
]);

function hasUnsafeControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function percentEncodeScalar(codePoint: number): string {
  const bytes =
    codePoint < 0x80
      ? [codePoint]
      : codePoint < 0x800
        ? [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)]
        : codePoint < 0x1_0000
          ? [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)]
          : [
              0xf0 | (codePoint >> 18),
              0x80 | ((codePoint >> 12) & 0x3f),
              0x80 | ((codePoint >> 6) & 0x3f),
              0x80 | (codePoint & 0x3f),
            ];
  return bytes.map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}

function encodeUrlComponent(value: string, ascii: ReadonlySet<string>): string {
  let encoded = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0x20;
    encoded += code < 0x80 && !ascii.has(character) ? character : percentEncodeScalar(code);
  }
  return encoded;
}

function removeDotSegments(path: string): string {
  const trailingSlash = path.endsWith("/") || path.endsWith("/.") || path.endsWith("/..");
  const absolute = path.startsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") {
      // An absolute path's leading empty segment is the root; ".." cannot pop it.
      if (segments.length > (absolute ? 1 : 0)) segments.pop();
    } else if (segment !== ".") {
      segments.push(segment);
    }
  }
  let result = segments.join("/");
  if (trailingSlash && !result.endsWith("/")) result += "/";
  return result === "" ? "/" : result;
}

function normalizeAuthority(authority: string): string | undefined {
  if (authority === "" || authority.includes("@")) return undefined;
  let host = authority;
  let portSuffix = "";
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 0) return undefined;
    host = authority.slice(0, close + 1);
    const remainder = authority.slice(close + 1);
    if (remainder !== "" && !remainder.startsWith(":")) return undefined;
    portSuffix = remainder;
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon >= 0) {
      host = authority.slice(0, colon);
      portSuffix = authority.slice(colon);
    }
    if (host.includes(":")) return undefined;
  }
  if (host === "") return undefined;
  const bracketed = host.startsWith("[");
  for (const character of host) {
    if (bracketed && (character === "[" || character === "]")) continue;
    const code = character.codePointAt(0) ?? 0x20;
    if (code < 0x80 && HOST_FORBIDDEN_ASCII.has(character)) return undefined;
  }
  if (portSuffix !== "") {
    const digits = portSuffix.slice(1);
    if (digits === "") {
      portSuffix = "";
    } else {
      if (!/^[0-9]+$/u.test(digits)) return undefined;
      const port = Number(digits);
      if (port > 65_535) return undefined;
      portSuffix = port === 443 ? "" : `:${port}`;
    }
  }
  return `${host.toLowerCase()}${portSuffix}`;
}

export function requirePortableHttpUrl(value: string, label: string): string {
  const invalid = () => {
    throw new Error(`${label} must be an absolute credential-free HTTPS URL`);
  };
  if (hasUnsafeControlCharacter(value)) invalid();
  if (!HTTPS_PREFIX_PATTERN.test(value) || value.includes("#")) invalid();

  const rest = value.slice(HTTPS_PREFIX.length);
  const authorityEnd = rest.search(/[/?]/u);
  const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd);
  const normalizedAuthority = normalizeAuthority(authority);
  if (normalizedAuthority === undefined) invalid();

  const tail = authorityEnd < 0 ? "" : rest.slice(authorityEnd);
  const queryStart = tail.indexOf("?");
  const rawPath = queryStart < 0 ? tail : tail.slice(0, queryStart);
  const rawQuery = queryStart < 0 ? "" : tail.slice(queryStart + 1);

  const path = encodeUrlComponent(
    removeDotSegments((rawPath === "" ? "/" : rawPath).replaceAll("\\", "/")),
    PATH_ENCODE_ASCII,
  );
  const query = rawQuery === "" ? "" : `?${encodeUrlComponent(rawQuery, QUERY_ENCODE_ASCII)}`;
  return `https://${normalizedAuthority}${path}${query}`;
}
