import type { BeforeSendEvent } from "@vercel/analytics/next";

/** Share paths contain the title/ref itself, so they never enter web analytics. */
export function filterPrivateShareAnalytics(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    if (new URL(event.url).pathname.startsWith("/w/")) return null;
  } catch {
    // An unexpected analytics URL shape is not a share path; preserve the
    // existing site behavior instead of silently dropping unrelated metrics.
  }
  return event;
}
