import { describe, expect, test } from "bun:test";

import { requirePortableHttpUrl } from "../../../src/application/portable-url";

const LABEL = "Probe URL";

describe("requirePortableHttpUrl", () => {
  test("canonicalizes scheme case, default port, host case, and dot segments", () => {
    expect(requirePortableHttpUrl("HTTPS://PROBE.EXAMPLE:443/a/../status", LABEL)).toBe(
      "https://probe.example/status",
    );
    expect(requirePortableHttpUrl("https://EXAMPLE.com", LABEL)).toBe("https://example.com/");
    expect(requirePortableHttpUrl("https://example.com:443/x", LABEL)).toBe(
      "https://example.com/x",
    );
    expect(requirePortableHttpUrl("https://example.com:", LABEL)).toBe("https://example.com/");
    expect(requirePortableHttpUrl("https://example.com:8443/x", LABEL)).toBe(
      "https://example.com:8443/x",
    );
    expect(requirePortableHttpUrl("https://example.com:080/x", LABEL)).toBe(
      "https://example.com:80/x",
    );
  });

  test("resolves dot segments without climbing above the root", () => {
    expect(requirePortableHttpUrl("https://x.example/a/b/../c/./d", LABEL)).toBe(
      "https://x.example/a/c/d",
    );
    expect(requirePortableHttpUrl("https://x.example/../../e", LABEL)).toBe("https://x.example/e");
    expect(requirePortableHttpUrl("https://x.example/a/b/", LABEL)).toBe("https://x.example/a/b/");
    expect(requirePortableHttpUrl("https://x.example/a/b/..", LABEL)).toBe("https://x.example/a/");
  });

  test("percent-encodes unsafe path and query scalars and keeps existing escapes", () => {
    expect(requirePortableHttpUrl('https://x.example/a b/"q"<t>`w`{z}^v', LABEL)).toBe(
      "https://x.example/a%20b/%22q%22%3Ct%3E%60w%60%7Bz%7D%5Ev",
    );
    expect(requirePortableHttpUrl("https://x.example/p?a='b'&c=d", LABEL)).toBe(
      "https://x.example/p?a=%27b%27&c=d",
    );
    expect(requirePortableHttpUrl("https://x.example/keep%20me?x=%2f", LABEL)).toBe(
      "https://x.example/keep%20me?x=%2f",
    );
    expect(requirePortableHttpUrl("https://x.example/münchen", LABEL)).toBe(
      "https://x.example/m%C3%BCnchen",
    );
  });

  test("keeps bracketed IPv6 hosts and ports", () => {
    expect(requirePortableHttpUrl("https://[2001:DB8::1]:8443/x", LABEL)).toBe(
      "https://[2001:db8::1]:8443/x",
    );
    expect(requirePortableHttpUrl("https://[::1]/", LABEL)).toBe("https://[::1]/");
  });

  test("rejects non-https schemes, credentials, fragments, and malformed authorities", () => {
    for (const url of [
      "http://x.example/",
      "ftp://x.example/",
      "//x.example/path",
      "https:///path",
      "https://",
      "https://user@x.example/",
      "https://user:pw@x.example/",
      "https://x.example/#frag",
      "https://x.example/path#",
      "https://x.example:notaport/",
      "https://x.example:65536/",
      "https://exa mple.com/",
      "https://exa[mple.com/",
      "https://a:b:c/",
    ]) {
      expect(() => requirePortableHttpUrl(url, LABEL)).toThrow("HTTPS");
    }
  });
});
