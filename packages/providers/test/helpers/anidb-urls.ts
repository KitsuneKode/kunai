/**
 * Host match that does not treat a hostname as a substring of the whole URL.
 *
 * `url.includes("graphql.anilist.co")` is true for
 * `https://evil.test/?x=graphql.anilist.co`, which would make a fetch stub
 * answer the wrong fixture. CodeQL flags the substring form as
 * `js/incomplete-url-substring-sanitization`.
 */
export function urlHasHostname(url: string, hostname: string): boolean {
  try {
    return new URL(url).hostname === hostname;
  } catch {
    return false;
  }
}

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
