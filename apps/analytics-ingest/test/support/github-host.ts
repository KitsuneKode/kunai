/**
 * Route fake distribution requests by parsed hostname. A substring check would
 * also match `https://evil.example/?api.github.com`, which CodeQL rightly flags.
 */
export function isGitHubApiUrl(url: string): boolean {
  return URL.parse(url)?.hostname === "api.github.com";
}
