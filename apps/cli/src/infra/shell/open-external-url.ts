/**
 * Open a URL in the user's default browser, best-effort across platforms.
 * Tries the common openers in order; the first that spawns wins. Never throws.
 */
export function openExternalUrl(url: string): void {
  if (!url) return;
  for (const opener of ["xdg-open", "open", "start"]) {
    try {
      Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
      return;
    } catch {
      // try the next opener
    }
  }
}
