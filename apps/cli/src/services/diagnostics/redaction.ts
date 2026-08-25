export type RedactionOptions = {
  readonly homeDir?: string;
  readonly maxStringLength?: number;
};

/**
 * The user's home directory, for collapsing local paths to `~`.
 *
 * `HOME` is a Unix convention. Windows sets `USERPROFILE` and frequently has no
 * `HOME` at all, so every caller that read `process.env.HOME` alone passed
 * `undefined` there -- and an undefined `homeDir` makes path redaction a no-op,
 * so diagnostic events, debug traces, and issue reports carried the user's real
 * home path. This is the one resolver; callers must not re-derive it.
 */
export function resolveRedactionHomeDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of ["HOME", "USERPROFILE"] as const) {
    const value = env[key];
    // A one-character "home" (`/`) would rewrite every slash in every path.
    if (typeof value === "string" && value.length > 1) return value;
  }
  return undefined;
}

const DEFAULT_MAX_STRING_LENGTH = 1_000;

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "token",
  "access-token",
  "refresh-token",
  "session-token",
  "sessiontoken",
  "signature",
  "sig",
  "videasysessiontoken",
  "x-session-token",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
  // TMDB v3 authenticates in the query string, so both of these ride in URLs
  // that reach diagnostics — the catalogue proxy sends `api_key` on every
  // metadata call, and account writes add `session_id`.
  "api_key",
  "session_id",
  "auth",
  "authorization",
  "expires",
  // The viewer's own address. Signed-HLS CDNs bind a token to it and hand both
  // back in the playback URL, so it arrives in diagnostics as ordinary query text.
  "ip",
  "md5",
  "expiresat",
  "expire",
  "key",
  "policy",
  "response-signature",
  "sig",
  "signature",
  "token",
]);

export function redactDiagnosticValue(value: unknown, options: RedactionOptions = {}): unknown {
  if (typeof value === "string") return redactString(value, options);
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, options));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactDiagnosticValue(entry, options);
  }
  return output;
}

function redactString(value: string, options: RedactionOptions): string {
  const redacted = redactEmbeddedUrls(redactPath(value, options));
  if (isOpaqueQueryValue(redacted.trim())) return "[redacted]";
  return truncate(redacted, options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH);
}

function redactEmbeddedUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
}

function redactPath(value: string, options: RedactionOptions): string {
  if (options.homeDir) {
    return value.replaceAll(options.homeDir, "~");
  }
  return value;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.pathname = redactPathIds(url.pathname);

    // Collect first, rewrite after: mutating `searchParams` while iterating it
    // is the kind of subtlety that only misbehaves on the input you did not test.
    const sensitive: string[] = [];
    for (const [key, param] of url.searchParams) {
      if (isSensitiveQueryKey(key) || isOpaqueQueryValue(param) || looksLikeIpAddress(param)) {
        sensitive.push(key);
      }
    }
    for (const key of sensitive) {
      url.searchParams.set(key, "[redacted]");
    }

    return url.toString().replaceAll("%5Bredacted%5D", "[redacted]");
  } catch {
    return "[redacted-url]";
  }
}

/**
 * A signed-CDN token rides in whatever parameter name that CDN happened to pick
 * -- `q`, `md5`, `hash`, `__token__` -- so a name denylist can never be
 * complete, and the ones it misses are exactly the ones that leak. This judges
 * the value instead.
 *
 * The constraint that shapes it: `?q=Dune` has to survive the same `q` key that
 * carries a token, or every trace loses the subject that makes it worth reading.
 * The unbroken-run test is what separates them. A token is one high-entropy
 * blob; a human value breaks into words, so its longest run between separators
 * stays short even when the whole string is long (`attack-on-titan-final-season`
 * runs to 6).
 */
const OPAQUE_MIN_LENGTH = 16;
const OPAQUE_MIN_UNBROKEN_RUN = 12;

/**
 * A canonical UUID — Kunai's own job, download, and correlation ids.
 *
 * These are generated locally by `crypto.randomUUID()`, identify nothing but a
 * row in the user's own database, and are the primary key for correlating a
 * failure across a trace. Redacting them removes the one field that makes a
 * support bundle answer "which job?" while protecting nothing.
 *
 * They are also structurally distinguishable from a bearer token rather than
 * merely allow-listed by name: 8-4-4-4-12 hex with a version nibble, so the
 * longest unbroken run is always exactly 12. A CDN token that happened to be
 * dash-separated into identical groups would still be an id-shaped string; a
 * real one never is, because its entropy arrives as one long run.
 */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOpaqueQueryValue(value: string): boolean {
  // Checked before the length gate on purpose: a UUID clears every other test
  // here — 36 chars, hex alphabet, mixed classes, and a trailing run of exactly
  // OPAQUE_MIN_UNBROKEN_RUN — so it is redacted by one character of margin.
  if (CANONICAL_UUID.test(value)) return false;
  if (value.length < OPAQUE_MIN_LENGTH) return false;
  // Base64url / hex alphabet, plus any padding the CDN left on.
  if (!/^[A-Za-z0-9_.~=-]+$/.test(value)) return false;
  // Tokens mix character classes. A slug, a date, or a version string does not.
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  const longestRun = value.split(/[-_.~=]+/).reduce((run, part) => Math.max(run, part.length), 0);
  return longestRun >= OPAQUE_MIN_UNBROKEN_RUN;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_FULL = /^(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i;
const IPV6_COMPRESSED = /^[0-9a-f:]*::[0-9a-f:]*$/i;

/** An address is the viewer's location whatever parameter name it arrives under. */
export function looksLikeIpAddress(value: string): boolean {
  if (IPV4.test(value)) return value.split(".").every((octet) => Number(octet) <= 255);
  if (IPV6_FULL.test(value)) return true;
  // `::` only ever appears in an IPv6 literal, never in a bare query value.
  return value.includes("::") && IPV6_COMPRESSED.test(value);
}

function isSensitiveQueryKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return (
    SENSITIVE_QUERY_KEYS.has(normalizedKey) ||
    normalizedKey.endsWith("-signature") ||
    normalizedKey.endsWith("-credential") ||
    normalizedKey.endsWith("-security-token") ||
    normalizedKey === "policy"
  );
}

function redactPathIds(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => (isOpaqueIdentifier(part) ? "[redacted-id]" : part))
    .join("/");
}

function isOpaqueIdentifier(value: string): boolean {
  if (!value) {
    return false;
  }
  if (/^\d{3,}$/.test(value)) {
    return true;
  }
  return /^[a-f0-9]{16,}$/i.test(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
