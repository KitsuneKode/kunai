export type BundleRedactionOptions = {
  /** Absolute home directory to collapse to `~` (e.g. `/home/ada`). */
  readonly homeDir?: string;
  /** OS username to scrub from process/env/path strings. */
  readonly username?: string;
};

const HOME_PATH_RE = /(?:^|[\s"'=])(\/(?:home|Users)\/[^/\s"'<>]+)/g;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/**
 * Pure support-bundle text redactor: collapses absolute home paths to `~`,
 * strips URL userinfo + query strings, and removes usernames from env/process strings.
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
  if (options.username && options.username.length > 0) {
    out = redactUsernameOccurrences(out, options.username);
  }
  return out;
}

/** Recursively redact strings inside JSON-like values for support bundles. */
export function redactBundleValue(value: unknown, options: BundleRedactionOptions = {}): unknown {
  if (typeof value === "string") return redactBundleText(value, options);
  if (Array.isArray(value)) return value.map((item) => redactBundleValue(item, options));
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = redactBundleValue(entry, options);
  }
  return output;
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
