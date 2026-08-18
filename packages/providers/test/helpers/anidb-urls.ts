/**
 * Host-and-port match for the official AniDB HTTP API.
 *
 * A `url.includes("api.anidb.net:9001")` stub matches any URL that merely
 * contains that text, so a fetch to `evil.test/?x=api.anidb.net:9001` would be
 * answered with the official-API fixture and the stub would quietly cover a
 * request the provider never should have made.
 */
export function isOfficialAnidbApi(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.anidb.net" && parsed.port === "9001";
  } catch {
    return false;
  }
}
