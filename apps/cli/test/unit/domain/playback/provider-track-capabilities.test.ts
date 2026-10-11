import { expect, test } from "bun:test";

import { buildProviderTrackCapabilities } from "@/domain/playback/provider-track-capabilities";
import type { ProviderMetadata } from "@/domain/types";

const providers: readonly ProviderMetadata[] = [
  {
    id: "vidking",
    name: "VidKing",
    description: "Series provider",
    isAnimeProvider: false,
    isYoutubeProvider: false,
    providerLane: "series",
  },
  {
    id: "allanime",
    name: "AllAnime",
    description: "Anime provider",
    isAnimeProvider: true,
    isYoutubeProvider: false,
    providerLane: "anime",
  },
  {
    id: "miruro",
    name: "Miruro",
    description: "Anime candidate",
    isAnimeProvider: true,
    isYoutubeProvider: false,
    providerLane: "anime",
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

test("lane eligibility lists cross-lane providers the picker would offer", () => {
  // A series title linked to anime ids can switch into anime providers — the
  // tracks panel must show the same set the provider picker offers.
  const group = buildProviderTrackCapabilities({
    providers,
    mode: "series",
    lanes: ["series", "anime"],
    currentProviderId: "vidking",
  });
  expect(group.rows.map((row) => row.value)).toEqual(["vidking", "allanime", "miruro"]);
});

test("the playing provider always lists even when lane eligibility excludes it", () => {
  // Cross-lane playback already started on a provider the title's ids no
  // longer qualify for — hiding it renders "No compatible providers" above
  // its own live source list.
  const group = buildProviderTrackCapabilities({
    providers,
    mode: "series",
    lanes: ["series"],
    currentProviderId: "allanime",
  });
  expect(group.rows.map((row) => row.value)).toEqual(["vidking", "allanime"]);
  expect(group.rows.find((row) => row.value === "allanime")?.selected).toBe(true);
  expect(group.rows.find((row) => row.value === "allanime")?.reason).toBe("Current provider");
});
