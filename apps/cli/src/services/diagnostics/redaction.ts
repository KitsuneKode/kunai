export type RedactionOptions = {
  readonly homeDir?: string;
  readonly maxStringLength?: number;
};

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
  "signature",
  "sig",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "access_token",
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
  if (options.homeDir && value.startsWith(options.homeDir)) {
    return `~${value.slice(options.homeDir.length)}`;
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
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[redacted]");
      }
    }

    return url.toString().replaceAll("%5Bredacted%5D", "[redacted]");
  } catch {
    return "[redacted-url]";
  }
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
