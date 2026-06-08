import { expect, test } from "bun:test";

import { buildProviderTrackCapabilities } from "@/domain/playback/provider-track-capabilities";
import type { ProviderMetadata } from "@/domain/types";

const providers: readonly ProviderMetadata[] = [
  {
    id: "vidking",
    name: "VidKing",
    description: "Series provider",
    isAnimeProvider: false,
    status: "production",
    recommended: true,
  },
  {
    id: "allanime",
    name: "AllAnime",
    description: "Anime provider",
    isAnimeProvider: true,
    status: "production",
    recommended: true,
  },
  {
    id: "miruro",
    name: "Miruro",
    description: "Anime candidate",
    isAnimeProvider: true,
    status: "candidate",
    recommended: false,
  },
];

test("buildProviderTrackCapabilities filters by anime vs series mode", () => {
  const anime = buildProviderTrackCapabilities({
    providers,
    mode: "anime",
    currentProviderId: "allanime",
  });
  expect(anime.rows.map((row) => row.value)).toEqual(["allanime", "miruro"]);
  expect(anime.rows.find((row) => row.value === "allanime")?.selected).toBe(true);
  expect(anime.rows.find((row) => row.value === "miruro")?.enabled).toBe(true);

  const series = buildProviderTrackCapabilities({
    providers,
    mode: "series",
    currentProviderId: "vidking",
  });
  expect(series.rows.map((row) => row.value)).toEqual(["vidking"]);
  expect(series.rows[0]?.enabled).toBe(false);
});

test("buildProviderTrackCapabilities surfaces health hints in detail", () => {
  const group = buildProviderTrackCapabilities({
    providers,
    mode: "anime",
    currentProviderId: "allanime",
    healthByProviderId: {
      allanime: {
        errorClass: "timeout",
        consecutiveFailures: 2,
        suggestedProviderId: "miruro",
      },
    },
  });
  const row = group.rows.find((entry) => entry.value === "allanime");
  expect(row?.detail).toContain("timeout");
  expect(row?.detail).toContain("miruro");
  expect(row?.risk).toBe("failed");
});
