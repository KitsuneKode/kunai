import { expect, test } from "bun:test";

import type { ProviderResolveInput, ProviderRuntimeContext } from "@kunai/types";

import { resolveDirectStreamSource } from "../src/shared/direct-stream-source";

const baseInput: ProviderResolveInput = {
  title: {
    id: "438631",
    tmdbId: "438631",
    kind: "movie",
    title: "Dune",
  },
  mediaKind: "movie",
  startupPriority: "balanced",
  intent: "play",
  allowedRuntimes: ["direct-http"],
};

function createContext(): ProviderRuntimeContext {
  return {
    now: () => "2026-07-09T12:00:00.000Z",
  };
}

test("resolveDirectStreamSource populates honesty fields from captions and audio hints", async () => {
  const result = await resolveDirectStreamSource({
    providerId: "vidlink",
    host: "vidlink.pro",
    label: "VidLink",
    input: baseInput,
    context: createContext(),
    fetchPayload: async () => ({
      streams: [
        {
          url: "https://cdn.example/ja.m3u8",
          qualityHint: "1080p",
          audioLanguages: ["ja"],
        },
        {
          url: "https://cdn.example/en.m3u8",
          qualityHint: "720p",
          audioLanguages: ["en"],
          presentation: "dub",
        },
      ],
      subtitles: [
        { url: "https://subs.example/en.vtt", language: "en", label: "English" },
        { url: "https://subs.example/es.vtt", language: "es" },
      ],
    }),
  });

  expect(result.status).toBe("resolved");
  expect(result.streams[0]).toMatchObject({
    presentation: "sub",
    subtitleDelivery: "external",
    subtitleLanguages: ["en", "es"],
    audioLanguages: ["ja"],
  });
  expect(result.streams[0]?.languageEvidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "audio", normalizedLanguage: "ja" }),
      expect.objectContaining({ role: "subtitle", normalizedLanguage: "en" }),
      expect.objectContaining({ role: "subtitle", normalizedLanguage: "es" }),
    ]),
  );
  expect(result.streams[1]).toMatchObject({
    presentation: "dub",
    subtitleDelivery: "external",
  });
  expect(result.variants?.[0]).toMatchObject({
    presentation: "sub",
    subtitleDelivery: "external",
    languageEvidence: result.streams[0]?.languageEvidence,
  });
});

test("resolveDirectStreamSource stays backward compatible without captions or audio hints", async () => {
  const result = await resolveDirectStreamSource({
    providerId: "rgshows",
    host: "rgshows.example",
    label: "RgShows",
    input: baseInput,
    context: createContext(),
    fetchPayload: async () => ({
      streams: [{ url: "https://cdn.example/auto.m3u8" }],
    }),
  });

  expect(result.status).toBe("resolved");
  expect(result.streams[0]?.subtitleDelivery).toBeUndefined();
  expect(result.streams[0]?.presentation).toBeUndefined();
  expect(result.streams[0]?.languageEvidence).toBeUndefined();
  expect(result.streams[0]?.subtitleLanguages).toBeUndefined();
});

test("resolveDirectStreamSource preserves explicit and hardsub subtitle delivery", async () => {
  const result = await resolveDirectStreamSource({
    providerId: "vidlink",
    host: "vidlink.pro",
    label: "VidLink",
    input: baseInput,
    context: createContext(),
    fetchPayload: async () => ({
      streams: [
        {
          url: "https://cdn.example/hardsub.m3u8",
          qualityHint: "1080p",
          hardSubLanguage: "en",
        },
        {
          url: "https://cdn.example/embedded.m3u8",
          qualityHint: "720p",
          subtitleDelivery: "embedded",
        },
      ],
      subtitles: [{ url: "https://subs.example/en.vtt", language: "en" }],
    }),
  });

  expect(result.status).toBe("resolved");
  expect(result.streams[0]).toMatchObject({
    hardSubLanguage: "en",
    subtitleDelivery: "hardcoded",
  });
  expect(result.streams[1]?.subtitleDelivery).toBe("embedded");
});
