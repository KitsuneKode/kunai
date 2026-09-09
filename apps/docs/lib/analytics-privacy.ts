/** Both telemetry SDKs carry a URL. Never forward a private or unparseable URL. */
export function filterPrivateShareAnalytics<T extends { readonly url: string }>(
  event: T,
): T | null {
  try {
    // Root-relative SDK events are supported without relying on the current
    // browser location: delayed events keep the privacy of their source page.
    const parsed = event.url.startsWith("/")
      ? new URL(event.url, "https://telemetry.invalid")
      : new URL(event.url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.pathname === "/w" || parsed.pathname.startsWith("/w/")) return null;
  } catch {
    return null;
  }
  return event;
}
