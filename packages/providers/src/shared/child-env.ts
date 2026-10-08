/**
 * Environment for third-party child processes (yt-dlp, curl impersonators,
 * ffmpeg). Mirrors the CLI's infra/os/child-env.ts — the two homes exist so
 * neither package reaches across its layer for a one-function util.
 *
 * Bun.spawn inherits the full parent environment when `env` is omitted, so
 * every spawned helper sees whatever tokens the user exports into their
 * shell — and yt-dlp `--verbose` dumps the env it saw into logs users paste
 * publicly. This is a denylist, not a sandbox; it keeps secret-shaped names
 * out of children that never legitimately consume them.
 */
const SECRET_ENV_SUFFIX =
  /(_TOKEN|_TOKENS|_SECRET|_SECRETS|_PASSWORD|_PASSWD|_PASS|_API_KEY|_APIKEY|_PRIVATE_KEY|_KEY|_CREDENTIAL|_CREDENTIALS)$/i;

export function scrubbedChildEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const scrubbed = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRET_ENV_SUFFIX.test(name)) continue;
    scrubbed.set(name, value);
  }
  return Object.fromEntries(scrubbed);
}
