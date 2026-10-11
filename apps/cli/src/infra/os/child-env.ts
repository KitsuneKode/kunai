/**
 * Environment for third-party child processes (mpv, yt-dlp, ffmpeg, curl).
 *
 * Bun.spawn inherits the full parent environment when `env` is omitted, so
 * every spawned helper sees AWS/GitHub/provider tokens the user exports into
 * their shell. Those tokens then travel — yt-dlp `--verbose` dumps the env
 * it saw into logs users paste publicly, and provider extractors forward
 * inherited headers in some configurations.
 *
 * This is a denylist, not a sandbox: a malicious local binary can read the
 * user's files regardless. The win is keeping secret-shaped names out of
 * children that never legitimately consume them — while leaving PATH, HOME,
 * DISPLAY, proxy vars, and Kunai's own non-secret overrides (`KUNAI_*` path
 * and smoke-harness vars) untouched.
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
