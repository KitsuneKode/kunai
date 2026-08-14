/** Random install id helpers. Never derive from host/hardware identity. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAC_RE = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export function isMacShaped(value: string): boolean {
  return MAC_RE.test(value.trim());
}

/** True when a candidate looks like a hostname or login name rather than a UUID. */
export function looksLikeHostnameOrUsername(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (UUID_RE.test(trimmed)) return false;
  if (isMacShaped(trimmed)) return true;
  // Hostnames / usernames are typically short labels without UUID structure.
  return !trimmed.includes(" ") && /^[A-Za-z0-9._-]+$/.test(trimmed);
}

export function isValidInstallId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Returns a persisted install id, generating a fresh `crypto.randomUUID()` when missing/invalid.
 * Callers persist the returned value via ConfigService.
 */
export function ensureInstallId(
  config: { readonly installId?: string },
  randomUUID: () => string = () => crypto.randomUUID(),
): string {
  const existing = typeof config.installId === "string" ? config.installId.trim() : "";
  if (
    isValidInstallId(existing) &&
    !isMacShaped(existing) &&
    !looksLikeHostnameOrUsername(existing)
  ) {
    return existing;
  }
  return randomUUID();
}
