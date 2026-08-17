/**
 * Shared curl / curl-impersonate resolution for Cloudflare-fronted providers.
 *
 * Cloudflare fingerprints the TLS handshake, so a browser User-Agent over
 * plain curl's handshake is frequently still challenged. Where an impersonate
 * build exists we use it; the candidate order matches ani-cli v5's
 * `dep_ch_failover` list, most-recent browser first, then plain curl.
 */
const CURL_IMPERSONATE_CANDIDATES = [
  "curl_firefox135",
  "curl_chrome136",
  "curl_chrome116",
  "curl_ff117",
  "curl",
] as const;

export type CurlCandidate = {
  readonly path: string;
  readonly impersonates: boolean;
};

/**
 * ani-cli sets cipher flags only on Darwin, and that restriction is
 * load-bearing: Windows `curl.exe` links Schannel, which rejects
 * `--tls13-ciphers` and does not understand OpenSSL cipher names, so passing
 * them there fails the request outright instead of hardening it.
 */
const CURL_CIPHERS =
  "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305";
const CURL_TLS13_CIPHERS =
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256";

/**
 * An impersonate build already ships a matching handshake, so forcing
 * ani-cli's cipher list over it would undo the fingerprint it exists to
 * provide.
 */
export function curlCipherArgs(
  impersonates: boolean,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  if (impersonates || platform !== "darwin") return [];
  return ["--ciphers", CURL_CIPHERS, "--tls13-ciphers", CURL_TLS13_CIPHERS];
}

export function resolveCurlCandidate(
  which: (command: string) => string | null = Bun.which,
): CurlCandidate | null {
  for (const candidate of CURL_IMPERSONATE_CANDIDATES) {
    const path = which(candidate);
    if (path) return { path, impersonates: candidate !== "curl" };
  }
  return null;
}

export function isCloudflareChallengeText(text: string): boolean {
  return /just a moment/i.test(text);
}
