/**
 * Stable identity for a source/server, used by favorites (persistence), the UI
 * (♥ + sort), and auto-select. Lowercase, strip everything that is not a letter
 * or digit so "VidLink", "Vid Link", "Vid-Link!" all map to "vidlink".
 */
export function normalizeSourceName(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}
