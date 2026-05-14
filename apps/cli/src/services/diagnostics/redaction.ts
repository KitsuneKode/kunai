export type RedactionOptions = {
  readonly homeDir?: string;
};

const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "token",
  "access-token",
  "refresh-token",
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
  if (/^https?:\/\//i.test(value)) return "[redacted-url]";
  if (options.homeDir && value.startsWith(options.homeDir)) {
    return `~${value.slice(options.homeDir.length)}`;
  }
  return value;
}
