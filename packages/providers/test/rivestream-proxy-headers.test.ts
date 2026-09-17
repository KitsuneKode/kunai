import { describe, expect, test } from "bun:test";

import { isProvenStreamRefusal, parseRivestreamProxyHeaders } from "../src/rivestream/direct";

const PROXY_URL = `https://proxy.valhallastream.dpdns.org/proxy?url=${encodeURIComponent(
  "https://cdn.example/upstream/master.m3u8",
)}&headers=${encodeURIComponent(JSON.stringify({ Referer: "https://123movienow.cc/" }))}`;

describe("parseRivestreamProxyHeaders", () => {
  test("forwards baked-in proxy headers instead of the static site referer", () => {
    expect(parseRivestreamProxyHeaders(PROXY_URL)).toEqual({
      Referer: "https://123movienow.cc/",
    });
  });

  test("returns null for direct (non-proxy) source URLs", () => {
    expect(
      parseRivestreamProxyHeaders("https://cdn1.ngcorp.dad/e/Fh9IbkdQQlxTRlY/master.m3u8"),
    ).toBeNull();
  });

  test("rejects malformed or empty header payloads", () => {
    expect(parseRivestreamProxyHeaders("https://proxy.example/proxy?url=x")).toBeNull();
    expect(
      parseRivestreamProxyHeaders("https://proxy.example/proxy?url=x&headers=not-json{"),
    ).toBeNull();
    expect(parseRivestreamProxyHeaders("https://proxy.example/proxy?url=x&headers=[]")).toBeNull();
    expect(parseRivestreamProxyHeaders("https://proxy.example/proxy?url=x&headers={}")).toBeNull();
  });

  test("strips CR/LF values and non-string entries", () => {
    const url =
      "https://proxy.example/proxy?url=x&headers=" +
      encodeURIComponent(
        JSON.stringify({ Referer: "https://a.example/\r\nEvil: 1", Count: 3, Ok: "yes" }),
      );
    expect(parseRivestreamProxyHeaders(url)).toEqual({
      Referer: "https://a.example/Evil: 1",
      Ok: "yes",
    });
  });

  test("returns null for non-URLs", () => {
    expect(parseRivestreamProxyHeaders("not a url")).toBeNull();
  });
});

describe("isProvenStreamRefusal", () => {
  test("fails candidates on HTTP refusals, HTML bodies, and truncated bodies", () => {
    expect(
      isProvenStreamRefusal({ status: "unreachable", definitive: true, reason: "HTTP 403" }),
    ).toBe(true);
    expect(
      isProvenStreamRefusal({
        status: "unreachable",
        definitive: true,
        reason: "HLS segment unreachable: HTTP 403",
      }),
    ).toBe(true);
    expect(
      isProvenStreamRefusal({
        status: "unreachable",
        definitive: true,
        reason: "HLS segment unreachable: content-type text/html",
      }),
    ).toBe(true);
    expect(
      isProvenStreamRefusal({
        status: "unreachable",
        definitive: true,
        reason: "HLS segment unreachable: body too small (12B)",
      }),
    ).toBe(true);
  });

  test("passes timeouts, non-definitive failures, and unparseable bodies", () => {
    expect(isProvenStreamRefusal({ status: "timeout" })).toBe(false);
    expect(
      isProvenStreamRefusal({ status: "unreachable", definitive: false, reason: "HTTP 500" }),
    ).toBe(false);
    expect(
      isProvenStreamRefusal({
        status: "unreachable",
        definitive: true,
        reason: "HLS media playlist has no segment URI",
      }),
    ).toBe(false);
  });
});
