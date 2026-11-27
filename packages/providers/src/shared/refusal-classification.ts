/**
 * Every 4xx is a refusal, and a refusal is a verdict.
 *
 * 429 was briefly treated as transient on the theory that a CDN throttling a CLI
 * probe says nothing about whether the stream plays. Live evidence says
 * otherwise: VidLink's CDN (`bcdn.hakunaymatata.com`) answers 429 to GET, HEAD
 * and ranged GET alike for every candidate, so letting the probe pass just hands
 * mpv a 587-byte nginx error page instead of a video. The gate exists to stop
 * exactly that, and a provider that fails here lets a working one take over.
 *
 * If a status ever needs to be treated as transient, it needs evidence that the
 * stream actually plays afterwards — a passing probe is not the goal, playback is.
 */
export function isDefinitiveHttpStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

export function isDefinitiveNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("econnrefused") ||
    lower.includes("name or service not known") ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound") ||
    lower.includes("unable to connect") ||
    lower.includes("certificate has expired") ||
    (lower.includes("certificate") && lower.includes("expired")) ||
    /*
      An unverifiable chain is as deterministic as an expired one: retrying
      cannot heal it, and mpv's TLS stack fails the same way against the same
      trust decision — so the stream must be rejected, not passed through
      lenient as "maybe a slow CDN". Covers OpenSSL/BoringSSL phrasings:
      "unable to verify the first certificate", "unable to verify leaf
      signature", "unable to get local issuer certificate",
      "self signed certificate in certificate chain".
    */
    lower.includes("unable to verify") ||
    lower.includes("unable to get local issuer") ||
    lower.includes("self signed certificate") ||
    lower.includes("certificate verify failed") ||
    lower.includes("unsupported protocol") ||
    lower.includes("unknown scheme") ||
    lower.includes("url using bad/illegal format")
  );
}
