const RELEASES_BASE = "https://github.com/KitsuneKode/kunai/releases";

/**
 * Build the GitHub releases page URL for an app-update notification. When a
 * concrete target version is known we deep-link to its tag (`v1.2.3`); otherwise
 * we fall back to the "latest release" page. Accepts versions with or without a
 * leading `v`.
 */
export function appReleasePageUrl(latestVersion: string | null | undefined): string {
  const version = latestVersion?.trim();
  if (!version) return `${RELEASES_BASE}/latest`;
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `${RELEASES_BASE}/tag/${encodeURIComponent(tag)}`;
}
