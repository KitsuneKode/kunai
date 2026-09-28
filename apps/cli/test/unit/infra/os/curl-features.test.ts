import { describe, expect, test } from "bun:test";

import { curlSupportsHttp2, parseCurlHttp2Support } from "@/infra/os/curl-features";

/** Real `curl --version` output, trimmed to the two lines that matter. */
const GNUTLS_CURL = [
  "curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3 nghttp2/1.59.0",
  "Release-Date: 2023-12-06",
  "Protocols: dict file ftp ftps gopher gophers http https imap imaps",
  "Features: alt-svc AsynchDNS brotli GSS-API HSTS HTTP2 HTTPS-proxy IDN IPv6 Largefile",
].join("\n");

/**
 * What Windows actually ships in System32: Schannel, no nghttp2, so no HTTP2
 * token. `--http2` against this build fails the request instead of downgrading.
 */
const WINDOWS_SCHANNEL_CURL = [
  "curl 8.9.1 (Windows) libcurl/8.9.1 Schannel WinIDN",
  "Release-Date: 2024-07-31",
  "Protocols: dict file ftp ftps http https imap imaps ipfs ipns mqtt pop3",
  "Features: AsynchDNS HSTS HTTPS-proxy IDN IPv6 Kerberos Largefile NTLM SPNEGO SSL SSPI threadsafe Unicode UnixSockets",
].join("\n");

describe("parseCurlHttp2Support", () => {
  test("detects the HTTP2 feature token", () => {
    expect(parseCurlHttp2Support(GNUTLS_CURL)).toBe(true);
  });

  test("does not credit the Windows Schannel build", () => {
    expect(parseCurlHttp2Support(WINDOWS_SCHANNEL_CURL)).toBe(false);
  });

  /**
   * HTTP3 sits beside HTTP2 in the feature list on builds that have it. A
   * substring test would read one as the other.
   */
  test("does not read HTTP3 as HTTP2", () => {
    expect(parseCurlHttp2Support("Features: AsynchDNS HSTS HTTP3 IPv6")).toBe(false);
  });

  test("treats an absent or unrunnable curl as no support", () => {
    expect(parseCurlHttp2Support(null)).toBe(false);
    expect(parseCurlHttp2Support("")).toBe(false);
  });
});

describe("curlSupportsHttp2", () => {
  test("uses the injected probe and never the host's curl", () => {
    expect(curlSupportsHttp2({ probeVersion: () => WINDOWS_SCHANNEL_CURL })).toBe(false);
    expect(curlSupportsHttp2({ probeVersion: () => GNUTLS_CURL })).toBe(true);
  });

  /**
   * The memoized default must not leak into an injected call: an injected
   * environment answering differently on the next call has to be believed.
   */
  test("an injected probe is not memoized", () => {
    let answer = GNUTLS_CURL;
    const environment = { probeVersion: () => answer };

    expect(curlSupportsHttp2(environment)).toBe(true);
    answer = WINDOWS_SCHANNEL_CURL;
    expect(curlSupportsHttp2(environment)).toBe(false);
  });
});
