import type { ServerResponse } from "node:http";

/** Cache policy for an error reply: never cache, so a fixed outage clears at once. */
export const NO_STORE = "no-store";

/** A not-yet-computed figure may appear within the hour; cache it briefly. */
export const NOT_READY_CACHE_CONTROL = "public, s-maxage=60, max-age=60";

/** Write one JSON reply. No CORS headers: nothing here is meant for a browser script. */
export function sendJson<T extends object>(
  res: ServerResponse,
  status: number,
  body: T,
  cacheControl: string,
): void {
  res.statusCode = status;
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
