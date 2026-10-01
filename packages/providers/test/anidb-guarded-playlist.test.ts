import { describe, expect, test } from "bun:test";

import type { ProviderRuntimeContext } from "@kunai/types";

import { resolveAnidbLanguageStreams } from "../src/anidb/client";

describe("anidb playlist redirects", () => {
  test("a master playlist redirect to a private address is not fetched", async () => {
    const calls: string[] = [];
    let privateFetched = false;
    const context = {
      fetch: {
        runtime: "direct-http",
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          const target = String(url);
          calls.push(target);
          if (target.includes("169.254.169.254")) {
            privateFetched = true;
            return new Response("secret", { status: 200 });
          }
          if (target.includes("/embed")) {
            return new Response("file: 'https://cdn.example/master.m3u8'", { status: 200 });
          }
          if (init?.redirect !== "manual") {
            privateFetched = true;
            calls.push("http://169.254.169.254/latest");
            return new Response("secret", { status: 200 });
          }
          return new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest" },
          });
        },
      },
      now: () => "2026-10-01T00:00:00.000Z",
    } as unknown as ProviderRuntimeContext;

    const result = await resolveAnidbLanguageStreams({
      context,
      audioMode: "sub",
      language: {
        code: "en",
        name: "English",
        embedUrl: "https://anidb.example/embed/1",
      },
    });

    expect(privateFetched).toBe(false);
    expect(calls.some((url) => url.includes("169.254.169.254"))).toBe(false);
    expect(result.links).toEqual([]);
  });
});
