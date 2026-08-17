/**
 * Constant-time bearer token check, shared by the cron and admin routes.
 *
 * A plain `===` on a secret leaks its length and its matching prefix through
 * timing. The window is small over a network, but these are long-lived
 * operator secrets on a public host, and the fix costs nothing.
 *
 * `timingSafeEqual` throws on a length mismatch, which would reintroduce the
 * leak it exists to prevent, so both sides are hashed to a fixed 32 bytes
 * first and the comparison always runs over equal lengths.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const BEARER_RE = /^Bearer\s+(.+)$/i;

function fixedWidth(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** False whenever either side is empty, so an unset secret can never match. */
export function secretsMatch(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  return timingSafeEqual(fixedWidth(presented), fixedWidth(expected));
}

/** Read and verify an `Authorization: Bearer …` header against `expected`. */
export function authorizeBearer(req: IncomingMessage, expected: string): boolean {
  if (!expected) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const match = BEARER_RE.exec(header.trim());
  return match ? secretsMatch(match[1] ?? "", expected) : false;
}
