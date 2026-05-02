import { expect, test } from "bun:test";

import { createVidKingProvider } from "@/services/providers/definitions/vidking";
import type { ProviderDeps } from "@/services/providers/Provider";
import { createVidkingResultFromPayload } from "@kunai/providers";

test("vidking resolves through the core provider result adapter", async () => {
  const deps: ProviderDeps = {
    browser: {
      async scrape() {
        return {
          url: "https://cdn.example/master.m3u8",
          headers: { referer: "https://www.vidking.net" },
          subtitleList: [{ url: "https://cdn.example/en.vtt", language: "en" }],
          subtitleSource: "provider",
          timestamp: 1,
        };
      },
      async isAvailable() {
        return true;
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      child() {
        return this;
      },
    },
    tracer: {
      async span(_name, fn) {
        return fn({
          id: "span-1",
          name: "test",
          startTime: 0,
          setAttribute() {},
          addEvent() {},
          end() {},
        });
      },
      getCurrentTrace() {
        return null;
      },
      getCurrentSpan() {
        return null;
      },
    },
    config: {
      defaultMode: "series",
      provider: "vidking",
      animeProvider: "allanime",
      subLang: "english",
      animeLang: "sub",
      headless: true,
      showMemory: false,
      autoNext: true,
      skipRecap: true,
      skipIntro: true,
      skipPreview: true,
      skipCredits: true,
      footerHints: "minimal",
      getRaw() {
        return this;
      },
      async update() {},
      async save() {},
      async reset() {},
    },
    playerDomains: ["vidking.net"],
  };
  const provider = createVidKingProvider(deps);

  const stream = await provider.resolveStream({
    title: { id: "438631", type: "movie", name: "Dune" },
    subLang: "english",
  });

  expect(stream?.providerResolveResult?.providerId).toBe("vidking");
  expect(stream?.providerResolveResult?.streams[0]?.protocol).toBe("hls");
  expect(stream?.providerResolveResult?.subtitles[0]?.language).toBe("en");
  expect(stream?.providerResolveResult?.trace.runtime).toBe("playwright-lease");
  expect(stream?.providerResolveResult?.cachePolicy?.keyParts).toContain("english");
});

test("vidking prefers the direct decode path before browser scraping", async () => {
  let browserCalls = 0;
  const deps: ProviderDeps = {
    browser: {
      async scrape() {
        browserCalls += 1;
        return null;
      },
      async isAvailable() {
        return true;
      },
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      fatal() {},
      child() {
        return this;
      },
    },
    tracer: {
      async span(_name, fn) {
        return fn({
          id: "span-1",
          name: "test",
          startTime: 0,
          setAttribute() {},
          addEvent() {},
          end() {},
        });
      },
      getCurrentTrace() {
        return null;
      },
      getCurrentSpan() {
        return null;
      },
    },
    config: {
      defaultMode: "series",
      provider: "vidking",
      animeProvider: "allanime",
      subLang: "en",
      animeLang: "sub",
      headless: true,
      showMemory: false,
      autoNext: true,
      skipRecap: true,
      skipIntro: true,
      skipPreview: true,
      skipCredits: true,
      footerHints: "minimal",
      getRaw() {
        return this;
      },
      async update() {},
      async save() {},
      async reset() {},
    },
    playerDomains: ["vidking.net"],
  };

  const provider = createVidKingProvider(deps, {
    resolveDirect: async (input) =>
      createVidkingResultFromPayload({
        input,
        payload: {
          sources: [{ url: "https://fast.speedzy.net/example/index.m3u8", quality: "1080p" }],
          subtitles: [
            {
              url: "https://cc.boopigcdn.com/example/eng-2.vtt",
              language: "English",
              label: "English",
            },
            {
              url: "https://cc.boopigcdn.com/example/spa.vtt",
              language: "Spanish",
              label: "Spanish",
            },
          ],
        },
        server: "mb-flix",
      })!,
  });

  const stream = await provider.resolveStream({
    title: { id: "1668", type: "series", name: "Friends", year: "1994" },
    episode: { season: 1, episode: 3 },
    subLang: "en",
  });

  expect(browserCalls).toBe(0);
  expect(stream?.subtitleSource).toBe("provider");
  expect(stream?.subtitle).toBe("https://cc.boopigcdn.com/example/eng-2.vtt");
  expect(stream?.providerResolveResult?.subtitles).toHaveLength(2);
  expect(stream?.providerResolveResult?.trace.runtime).toBe("node-fetch");
});
