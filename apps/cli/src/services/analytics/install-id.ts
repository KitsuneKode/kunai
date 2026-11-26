/** Random install id helpers. Never derive from host/hardware identity. */

import { createHmac } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAC_RE = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

export function isMacInstallId(value: string): boolean {
  return MAC_RE.test(value.trim());
}

/** True when a candidate looks like a hostname or login name rather than a UUID. */
export function looksLikeHostnameOrUsername(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (UUID_RE.test(trimmed)) return false;
  if (isMacInstallId(trimmed)) return true;
  // Hostnames / usernames are typically short labels without UUID structure.
  return !trimmed.includes(" ") && /^[A-Za-z0-9._-]+$/.test(trimmed);
}

export function isValidInstallId(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * What actually goes on the wire: `HMAC-SHA256(key = installId, message = month)`.
 *
 * The stored id never leaves the machine. Keying the HMAC with it and rotating
 * the message every calendar month means the endpoint sees one stable id per
 * install per month, which keeps daily and monthly active counts exact. It can
 * neither recover the stored id nor link one month's id to the next: without
 * the key, `2026-11` and `2026-12` are unrelated digests. The ingest still
 * HMACs whatever arrives, so this is a client-owned layer, not a replacement.
 *
 * `month` is the `YYYY-MM` of the ping's own `day` label (`analyticsMonthKey`).
 */
export function monthlyWireId(installId: string, month: string): string {
  return createHmac("sha256", installId.trim()).update(month, "utf8").digest("hex");
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
    !isMacInstallId(existing) &&
    !looksLikeHostnameOrUsername(existing)
  ) {
    return existing;
  }
  return randomUUID();
}
