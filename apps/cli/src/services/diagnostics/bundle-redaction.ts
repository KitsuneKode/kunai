export type BundleRedactionOptions = {
  /** Absolute home directory to collapse to `~` (e.g. `/home/ada`). */
  readonly homeDir?: string;
  /** OS username to scrub from process/env/path strings. */
  readonly username?: string;
};

const HOME_PATH_RE = /(?:^|[\s"'=])(\/(?:home|Users)\/[^/\s"'<>]+)/g;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
/** Inventory / evidence lines often embed `host cdn.example` without a full URL. */
const HOST_HINT_RE =
  /\bhost\s+([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\b/gi;

/**
 * Object keys whose string values must never appear in a support bundle.
 * Values are replaced with `[redacted]` and also scrubbed from sibling strings
 * (e.g. `message`) so query/title text cannot survive via free-form fields.
 */
const SENSITIVE_CONTENT_KEYS = new Set([
  "query",
  "search",
  "searchquery",
  "q",
  "title",
  "titlename",
  "displaytitle",
  "mediatitle",
  "watchedtitle",
  "showtitle",
  "animetitle",
  "seriestitle",
  "movietitle",
  "episodetitle",
]);

const HOST_FIELD_KEYS = new Set(["host", "streamhost", "cdnhost"]);

/**
 * Pure support-bundle text redactor: collapses absolute home paths to `~`,
 * strips URL userinfo + query strings, redacts stream hosts / host hints,
 * and removes usernames from env/process strings.
 *
 * Non-stream HTTPS URLs keep their host after query/auth stripping so maintainers
 * can still see which API endpoint failed (e.g. `https://api.example/v1/meta`).
 */
export function redactBundleText(value: string, options: BundleRedactionOptions = {}): string {
  let out = value;
  if (options.homeDir && options.homeDir.length > 1) {
    out = out.replaceAll(options.homeDir, "~");
  }
  out = out.replace(HOME_PATH_RE, (match, homeRoot: string) => {
    const prefix = match.slice(0, match.length - homeRoot.length);
    return `${prefix}~`;
  });
  out = out.replace(URL_RE, (url) => redactBundleUrl(url));
  out = out.replace(HOST_HINT_RE, "host [redacted-host]");
  if (options.username && options.username.length > 0) {
    out = redactUsernameOccurrences(out, options.username);
  }
  return out;
}

/** Recursively redact strings inside JSON-like values for support bundles. */
export function redactBundleValue(value: unknown, options: BundleRedactionOptions = {}): unknown {
  const secrets = collectSensitiveLiterals(value);
  const structured = redactStructure(value, options, undefined);
  return secrets.length > 0 ? scrubLiteralSecrets(structured, secrets, options) : structured;
}

export function resolveBundleRedactionOptions(
  env: NodeJS.ProcessEnv = process.env,
): BundleRedactionOptions {
  const homeDir = typeof env.HOME === "string" && env.HOME.length > 1 ? env.HOME : undefined;
  const username =
    (typeof env.USER === "string" && env.USER.length > 0 ? env.USER : undefined) ??
    (typeof env.USERNAME === "string" && env.USERNAME.length > 0 ? env.USERNAME : undefined) ??
    (homeDir ? usernameFromHomeDir(homeDir) : undefined);
  return { homeDir, username };
}

function collectSensitiveLiterals(value: unknown): string[] {
  const found: string[] = [];
  walkSensitiveLiterals(value, undefined, found);
  // Longest first so nested phrases (title inside query) scrub cleanly.
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

function walkSensitiveLiterals(value: unknown, key: string | undefined, found: string[]): void {
  if (typeof value === "string") {
    if (key && SENSITIVE_CONTENT_KEYS.has(key.toLowerCase()) && value.trim().length >= 2) {
      found.push(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkSensitiveLiterals(item, key, found);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [entryKey, entry] of Object.entries(value)) {
    walkSensitiveLiterals(entry, entryKey, found);
  }
}

function redactStructure(
  value: unknown,
  options: BundleRedactionOptions,
  key: string | undefined,
): unknown {
  if (typeof value === "string") {
    if (key && SENSITIVE_CONTENT_KEYS.has(key.toLowerCase())) {
      return "[redacted]";
    }
    const normalizedKey = key?.toLowerCase();
    if (normalizedKey && HOST_FIELD_KEYS.has(normalizedKey)) {
      return "[redacted-host]";
    }
    if (normalizedKey === "label" && looksLikeHostname(value)) {
      return "[redacted-host]";
    }
    return redactBundleText(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStructure(item, options, key));
  }
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [entryKey, entry] of Object.entries(value)) {
    if (SENSITIVE_CONTENT_KEYS.has(entryKey.toLowerCase())) {
      output[entryKey] = "[redacted]";
      continue;
    }
    output[entryKey] = redactStructure(entry, options, entryKey);
  }
  return output;
}

function scrubLiteralSecrets(
  value: unknown,
  secrets: readonly string[],
  options: BundleRedactionOptions,
): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const secret of secrets) {
      if (secret.length < 2) continue;
      out = out.split(secret).join("[redacted]");
    }
    return redactBundleText(out, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubLiteralSecrets(item, secrets, options));
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = scrubLiteralSecrets(entry, secrets, options);
  }
  return output;
}

function redactBundleUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    if (looksLikeStreamUrl(url)) {
      url.host = "redacted-host";
    }
    // URL() may emit empty auth as "://" artifacts; normalize.
    return url.toString().replace("://@", "://");
  } catch {
    return "[redacted-url]";
  }
}

function looksLikeStreamUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return (
    path.endsWith(".m3u8") ||
    path.endsWith(".mpd") ||
    path.endsWith(".mp4") ||
    path.endsWith(".mkv") ||
    path.endsWith(".webm") ||
    path.endsWith(".ts") ||
    path.includes("/stream") ||
    path.includes("/play")
  );
}

function looksLikeHostname(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.includes("/") || trimmed.includes(" ")) return false;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(trimmed);
}

function redactUsernameOccurrences(value: string, username: string): string {
  // Escape for RegExp; require non-identifier boundaries so we do not mangle
  // longer tokens that merely contain the username as a substring.
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_.-])(${escaped})(?=[^A-Za-z0-9_.-]|$)`, "g");
  return value.replace(re, "$1~");
}

function usernameFromHomeDir(homeDir: string): string | undefined {
  const parts = homeDir.replace(/\/+$/, "").split("/");
  const last = parts.at(-1);
  return last && last.length > 0 && last !== "home" && last !== "Users" ? last : undefined;
}
