import { expect, test } from "bun:test";

import {
  createVidkingResultFromPayload,
  createProviderModuleRegistry,
  getProviderMigrationQueue,
  getProviderResearchProfile,
  providerResearchProfiles,
  vidkingProviderModule,
} from "../src/index";

test("provider module registry can expose migrated modules", () => {
  const registry = createProviderModuleRegistry([vidkingProviderModule]);

  expect(registry.modules.map((module) => module.providerId)).toEqual(["vidking"]);
  expect(registry.get("vidking")).toBe(vidkingProviderModule);
});

test("provider research profiles are dossier-backed and migration ordered", () => {
  const queue = getProviderMigrationQueue();

  expect(queue[0]?.providerId).toBe("vidking");
  expect(queue[1]?.providerId).toBe("allanime");
  expect(queue.every((profile) => profile.dossierPath.startsWith(".docs/provider-dossiers/"))).toBe(
    true,
  );
  expect(providerResearchProfiles.length).toBeGreaterThanOrEqual(8);
});

test("provider research profiles separate direct providers from legacy fallbacks", () => {
  expect(getProviderResearchProfile("vidking")).toMatchObject({
    status: "production",
    migrationAction: "promote-direct-provider",
    runtimeClass: "node-fetch direct Videasy payload decode, Playwright fallback only",
  });

  expect(getProviderResearchProfile("cineby")).toMatchObject({
    status: "legacy-fallback",
    migrationAction: "keep-as-fallback",
  });

  expect(getProviderResearchProfile("anikai")).toMatchObject({
    migrationAction: "hold-for-runtime-browser",
  });
});

test("vidking direct payload creates selected stream, variants, and subtitle inventory", () => {
  const result = createVidkingResultFromPayload({
    input: {
      title: {
        id: "1668",
        tmdbId: "1668",
        kind: "series",
        title: "Friends",
        year: 1994,
      },
      episode: { season: 1, episode: 2 },
      mediaKind: "series",
      preferredSubtitleLanguage: "en",
      qualityPreference: "1080",
      intent: "play",
      allowedRuntimes: ["node-fetch"],
    },
    payload: {
      sources: [
        { url: "https://cdn.example/720/index.m3u8", quality: "720p" },
        { url: "https://cdn.example/1080/index.m3u8", quality: "1080p" },
      ],
      subtitles: [
        {
          url: "https://subs.example/en-sdh.vtt",
          language: "English SDH",
          release: "SDH",
        },
        {
          file: "https://subs.example/en.vtt",
          language: "English",
          release: "Clean",
        },
        {
          href: "https://subs.example/es.vtt",
          lang: "spa",
          label: "Spanish",
        },
      ],
    },
    server: "mb-flix",
  });

  expect(result?.selectedStreamId).toBe(result?.streams[0]?.id);
  expect(result?.streams[0]).toMatchObject({
    qualityLabel: "1080p",
    protocol: "hls",
    container: "m3u8",
  });
  expect(result?.variants).toHaveLength(2);
  expect(result?.subtitles.map((subtitle) => subtitle.language)).toEqual(["en", "en", "es"]);
  expect(result?.subtitles[0]?.url).toBe("https://subs.example/en.vtt");
  expect(result?.trace.events?.map((event) => event.type)).toContain("variant:selected");
});
