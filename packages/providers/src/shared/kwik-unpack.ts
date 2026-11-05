/**
 * Unpacker and stream extractor for Kwik / AnimePahe video embeds.
 *
 * Implements:
 * 1. O(N) Dean Edwards base-N packer decoder (`eval(function(p,a,c,k,e,d)...)`).
 * 2. Form token and direct m3u8/mp4 stream URL extraction from unpacked embed payloads.
 */

export interface UnpackedKwikStream {
  readonly url: string;
  readonly protocol: "hls" | "progressive";
  readonly headers: Record<string, string>;
}

export interface KwikFormToken {
  readonly actionUrl: string;
  readonly token: string;
}

/**
 * Decode a base-N character string (0-9, a-z, A-Z) to an integer.
 * Radix supports up to 62 (standard Dean Edwards alphabet).
 */
export function decodeBaseN(str: string, radix: number): number {
  if (radix < 2 || radix > 62 || str.length === 0) return -1;
  let val = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    let digit: number;
    if (code >= 48 && code <= 57) {
      digit = code - 48; // '0'-'9' -> 0..9
    } else if (code >= 97 && code <= 122) {
      digit = code - 87; // 'a'-'z' -> 10..35
    } else if (code >= 65 && code <= 90) {
      digit = code - 29; // 'A'-'Z' -> 36..61
    } else {
      return -1;
    }
    if (digit >= radix) return -1;
    val = val * radix + digit;
  }
  return val;
}

/**
 * Unpack a Dean Edwards packed JavaScript string without running `eval()`.
 * Matches standard `}(payload, a, c, words, ...))` patterns.
 */
export function unpackDeanEdwards(script: string): string | null {
  const match = script.match(
    /\}\s*\(\s*(['"])([\s\S]+?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]+?)\5(?:\.split\(['"]\|['"]\))?/,
  );
  if (!match) return null;

  const rawPayload = match[2];
  const radixStr = match[3];
  const wordCountStr = match[4];
  const wordsStr = match[6];
  if (!rawPayload || !radixStr || !wordCountStr || !wordsStr) return null;

  const radix = parseInt(radixStr, 10);
  const wordCount = parseInt(wordCountStr, 10);
  const words = wordsStr.split("|");

  if (radix < 2 || radix > 62 || isNaN(wordCount)) return null;

  // Unescape quotes and slashes inside payload
  const payload = rawPayload.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  return payload.replace(/\b\w+\b/g, (token) => {
    const idx = decodeBaseN(token, radix);
    const word = words[idx];
    if (idx >= 0 && idx < words.length && word && word.length > 0) {
      return word;
    }
    return token;
  });
}

/**
 * Extract stream URL (.m3u8 or .mp4) from Kwik embed HTML or unpacked JavaScript.
 */
export function extractKwikStreamFromEmbed(
  content: string,
  embedHost = "kwik.cx",
): UnpackedKwikStream | null {
  // If the content is packed, unpack it first
  const scriptContent = unpackDeanEdwards(content) ?? content;

  // Pattern 1: source = 'https://...m3u8' or src = "https://...mp4"
  const urlMatch =
    scriptContent.match(
      /(?:source|src|file)\s*[:=]\s*['"](https?:\/\/[^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i,
    ) ?? scriptContent.match(/['"](https?:\/\/[^'"\s<>]+\.(?:m3u8|mp4)[^'"\s<>]*)['"]/i);

  const matchedUrl = urlMatch?.[1];
  if (!matchedUrl) return null;

  const isHls = matchedUrl.includes(".m3u8");

  return {
    url: matchedUrl,
    protocol: isHls ? "hls" : "progressive",
    headers: {
      Referer: `https://${embedHost}/`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  };
}

/**
 * Extract form action URL and hidden _token from POST-based Kwik gates.
 */
export function parseKwikFormToken(html: string): KwikFormToken | null {
  const formMatch = html.match(/<form\s+[^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) return null;

  const actionUrl = formMatch[1];
  const formBody = formMatch[2];
  if (!actionUrl || !formBody) return null;

  const tokenMatch =
    formBody.match(/<input\s+[^>]*name=["']_token["'][^>]*value=["']([^"']+)["'][^>]*>/i) ??
    formBody.match(/<input\s+[^>]*value=["']([^"']+)["'][^>]*name=["']_token["'][^>]*>/i);

  const token = tokenMatch?.[1];
  if (!token) return null;

  return {
    actionUrl,
    token,
  };
}
