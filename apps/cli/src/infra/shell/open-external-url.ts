const DISABLE_EXTERNAL_URL_ENV = "KUNAI_DISABLE_EXTERNAL_URL";

/** Default docs target when `KUNAI_DOCS_URL` is unset. Override in prod via env. */
export function defaultKunaiDocsUrl(): string {
  return process.env.KUNAI_DOCS_URL ?? "https://github.com/KitsuneKode/kunai/tree/main/docs";
}

/** True when external browser/file openers must not run (tests, CI, headless). */
export function isExternalUrlOpeningDisabled(): boolean {
  const flag = process.env[DISABLE_EXTERNAL_URL_ENV];
  return flag === "1" || flag === "true";
}

async function spawnExternalUrl(url: string): Promise<boolean> {
  if (!url || isExternalUrlOpeningDisabled()) {
    return false;
  }

  const commands: readonly [string, readonly string[]][] = [
    ["xdg-open", [url]],
    ["open", [url]],
    ["cmd", ["/c", "start", "", url]],
  ];

  for (const [command, args] of commands) {
    if (!Bun.which(command)) continue;
    try {
      const proc = Bun.spawn([command, ...args], {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      if ((await proc.exited) === 0) return true;
    } catch {
      // try next opener
    }
  }

  return false;
}

/**
 * Open a URL in the user's default browser, best-effort across platforms.
 * No-ops when `KUNAI_DISABLE_EXTERNAL_URL=1` (set automatically in test preload).
 */
export function openExternalUrl(url: string): void {
  if (!url || isExternalUrlOpeningDisabled()) return;
  void spawnExternalUrl(url);
}

/** Awaitable opener for workflow commands that need to finish before returning. */
export async function openExternalUrlAndWait(url: string): Promise<boolean> {
  return spawnExternalUrl(url);
}
