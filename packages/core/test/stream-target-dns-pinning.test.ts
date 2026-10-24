import { describe, expect, test } from "bun:test";

import { fetchProbeTarget } from "../src/stream-target-guard";

describe("stream fetch DNS binding", () => {
  test("connects to the vetted address with the original authority and TLS name", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const result = await fetchProbeTarget({
      url: "https://media.example/video",
      init: { headers: { Cookie: "fixture", Host: "untrusted.example" } },
      remaining: () => 1000,
      resolveNamesFor: () => true,
      resolveAddresses: async () => ["93.184.216.34"],
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response("media");
      },
    });
    expect(result.kind).toBe("response");
    expect(calls[0]?.url).toBe("https://93.184.216.34/video");
    expect(new Headers(calls[0]?.init.headers).get("host")).toBe("media.example");
    expect(calls[0]?.init).toMatchObject({ proxy: false, tls: { serverName: "media.example" } });
    expect(result).toMatchObject({ finalUrl: "https://media.example/video" });
  });

  test("revalidates each redirect and strips credentials across authorities", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await fetchProbeTarget({
      url: "https://media.example/start",
      init: {
        headers: {
          Cookie: "fixture",
          Authorization: "Bearer fixture",
          "X-Session-Token": "fixture",
          Referer: "https://embed.example/",
        },
      },
      remaining: () => 1000,
      resolveNamesFor: () => true,
      resolveAddresses: async (host) =>
        host === "media.example" ? ["93.184.216.34"] : ["2606:4700:4700::1111"],
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return calls.length === 1
          ? new Response(null, { status: 302, headers: { Location: "https://cdn.example/end" } })
          : new Response("media");
      },
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://93.184.216.34/start",
      "https://[2606:4700:4700::1111]/end",
    ]);
    expect(new Headers(calls[1]?.init.headers).get("cookie")).toBeNull();
    expect(new Headers(calls[1]?.init.headers).get("authorization")).toBeNull();
    expect(new Headers(calls[1]?.init.headers).get("x-session-token")).toBeNull();
    expect(new Headers(calls[1]?.init.headers).get("referer")).toBe("https://embed.example/");
    expect(calls[1]?.init).toMatchObject({ tls: { serverName: "cdn.example" } });
  });

  for (const answers of [[], ["93.184.216.34", "127.0.0.1"]]) {
    test(`never falls back to hostname resolution for ${JSON.stringify(answers)}`, async () => {
      let calls = 0;
      const result = await fetchProbeTarget({
        url: "https://media.example/video",
        init: {},
        remaining: () => 1000,
        resolveNamesFor: () => true,
        resolveAddresses: async () => answers,
        fetchImpl: async () => {
          calls += 1;
          return new Response("media");
        },
      });
      expect(result.kind).toBe("blocked");
      expect(calls).toBe(0);
    });
  }
});
