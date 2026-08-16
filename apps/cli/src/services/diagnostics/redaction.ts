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

    for (const key of url.searchParams.keys()) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }

    return url.toString().replaceAll("%5Bredacted%5D", "[redacted]");
  } catch {
    return "[redacted-url]";
  }
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
