/** Random install id helpers. Never derive from host/hardware identity. */

import { createHash } from "node:crypto";

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
 * What actually goes on the wire: `sha256(installId)`.
 *
 * The stored id stays on disk and is what Settings shows the user; only its
 * digest is ever sent, so the endpoint -- ours, or a self-hoster's, or one that
 * has been compromised -- never holds the raw value. The ingest HMACs whatever
 * arrives, so this is a second, client-owned layer rather than a replacement.
 *
 * Deterministic on purpose: the same install has to produce the same digest
 * every day or the daily-active count becomes a count of pings. Rotation is the
 * supported way to become a new install; see `rotateInstallId`.
 */
export function installIdDigest(installId: string): string {
  return createHash("sha256").update(installId.trim(), "utf8").digest("hex");
}

/**
 * A fresh identity. Deliberately not derived from the previous id -- a rotation
 * that could be linked back to what it replaced would not be a rotation.
 */
export function rotateInstallId(randomUUID: () => string = () => crypto.randomUUID()): string {
  return randomUUID();
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
