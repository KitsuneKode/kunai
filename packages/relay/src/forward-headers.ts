import type { RelayErrorCode } from "./types";

const METADATA_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "content-type",
  "origin",
  "referer",
  "referrer",
  "user-agent",
]);

const MEDIA_HEADER_ALLOWLIST = new Set([...METADATA_HEADER_ALLOWLIST, "range", "if-range"]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type RelayHeadersInit = ConstructorParameters<typeof Headers>[0];

export class RelayValidationError extends Error {
  override readonly name = "RelayValidationError";

  constructor(
    readonly code: RelayErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function filterForwardHeaders(
  input: RelayHeadersInit | undefined,
  kind: "metadata" | "media" = "metadata",
): Record<string, string> {
  const source = new Headers(input);
  const allowed = kind === "media" ? MEDIA_HEADER_ALLOWLIST : METADATA_HEADER_ALLOWLIST;
  const output: Record<string, string> = {};

  for (const [rawName, rawValue] of source.entries()) {
    const name = rawName.toLowerCase();
    const value = rawValue.trim();
    if (containsInvalidHeaderText(name) || containsInvalidHeaderText(value)) {
      throw new RelayValidationError("headers-rejected", "Unsafe header text rejected", 400);
    }
    if (HOP_BY_HOP_HEADERS.has(name) || name === "authorization" || name === "cookie") {
      continue;
    }
    if (!allowed.has(name)) continue;
    output[canonicalHeaderName(name)] = value;
  }

  return output;
}

export function mergeRelayHeaders(
  defaults: Readonly<Record<string, string>> | undefined,
  forwarded: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    ...defaults,
    ...forwarded,
  };
}

function containsInvalidHeaderText(value: string): boolean {
  return value.includes("\r") || value.includes("\n") || value.includes("\0");
}

function canonicalHeaderName(name: string): string {
  switch (name) {
    case "accept":
      return "Accept";
    case "accept-language":
      return "Accept-Language";
    case "content-type":
      return "Content-Type";
    case "if-range":
      return "If-Range";
    case "origin":
      return "Origin";
    case "range":
      return "Range";
    case "referer":
    case "referrer":
      return "Referer";
    case "user-agent":
      return "User-Agent";
    default:
      return name;
  }
}
