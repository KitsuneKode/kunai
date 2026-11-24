import { describe, expect, test } from "bun:test";

import { buildCapabilitiesReport, runCapabilities } from "@/services/agent/run-capabilities";
import {
  runHeadlessSearchJson,
  type HeadlessSearchContainer,
} from "@/services/agent/run-headless-search";
import type { Provider } from "@/services/providers/Provider";

describe("runCapabilities", () => {
  test("reports real production providers, built-in themes, and headless routes", async () => {
    const report = await buildCapabilitiesReport("0.4.0");
    expect(report.schemaVersion).toBe(1);
    expect(report.version).toBe("0.4.0");
    expect(report.exitCodes).toEqual({ ok: 0, error: 1, usage: 2 });
    expect(report.providers.length).toBeGreaterThanOrEqual(11);
    expect(report.themes).toContain("ember-dusk");
    expect(report.themes).toContain("nord");
    expect(report.hdrModes).toEqual(["auto", "passthrough", "tone-map", "sdr-only"]);
    expect(report.subcommands).toContain("capabilities");
    expect(report.providerHotfixManifest.signatureAlgorithm).toBe("Ed25519");
  });

  test("emits parseable JSON in --json mode and exits 0", async () => {
    let out = "";
    const code = await runCapabilities({
      version: "0.4.0",
      json: true,
      write: (chunk) => {
        out += chunk;
      },
    });
    expect(code).toBe(0);
    // SAFETY: runCapabilities writes a serialized CapabilitiesReport JSON object in --json mode.
    const parsed = JSON.parse(out) as { schemaVersion: number; providers: unknown[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.providers.length).toBeGreaterThanOrEqual(11);
  });
});

describe("runHeadlessSearchJson", () => {
  test("serializes search results as schema v1 JSON and exits 0", async () => {
    let out = "";
    const animeProvider: Provider = {
      metadata: {
        id: "hianime",
        name: "HiAnime",
        description: "",
        isAnimeProvider: true,
        isYoutubeProvider: false,
        providerLane: "anime",
        domain: "hianime.to",
      },
      canHandle: () => true,
      search: async () => [
        {
          id: "frieren-1",
          title: "Frieren: Beyond Journey's End",
          type: "series",
          year: "2023",
          rating: 9.3,
          posterPath: "/frieren.jpg",
          overview: "",
        },
      ],
    };
    const container: HeadlessSearchContainer = {
      config: {
        offlineMode: false,
        provider: "movy",
        animeProvider: "hianime",
        youtubeProvider: "youtube",
        animeLanguageProfile: { audio: "original", subtitle: "en" },
      },
      providerRegistry: {
        get: (id: string) => (id === "hianime" ? animeProvider : undefined),
        getManifest: () => undefined,
        getAll: () => [animeProvider],
        getAllRegistered: () => [animeProvider],
        getAllIds: () => ["hianime"],
        getCompatible: () => [animeProvider],
        getDefault: () => animeProvider,
        getDefaultForMode: () => animeProvider,
        getMetadata: (id: string) => (id === "hianime" ? animeProvider.metadata : undefined),
        setPriority: () => {},
      },
      searchRegistry: {
        getDefault: () => ({
          id: "tmdb",
          metadata: { id: "tmdb", name: "TMDB", description: "" },
          compatibleProviders: [],
          search: async () => [],
          getTitleDetails: async () => null,
        }),
        getForProvider: () => undefined,
      },
    };

    const code = await runHeadlessSearchJson({
      container,
      query: "Frieren",
      mode: "anime",
      write: (chunk) => {
        out += chunk;
      },
    });

    expect(code).toBe(0);
    // SAFETY: runHeadlessSearchJson writes a schema v1 search JSON envelope.
    const parsed = JSON.parse(out) as {
      schemaVersion: number;
      mode: string;
      query: string;
      count: number;
      results: { id: string; title: string }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.mode).toBe("anime");
    expect(parsed.query).toBe("Frieren");
    expect(parsed.count).toBe(1);
    expect(parsed.results[0]).toMatchObject({
      id: "frieren-1",
      title: "Frieren: Beyond Journey's End",
    });
  });
});
