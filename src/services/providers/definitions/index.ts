// =============================================================================
// Provider Definitions Registry
//
// Export all provider definitions for the registry.
// Adding a provider = 1 file in this directory + 1 export here.
// =============================================================================

import type { ProviderDefinition } from "../Provider";
import { createVidKingProvider } from "./vidking";
import { createCinebyProvider } from "./cineby";
import { createBitCineProvider } from "./bitcine";
import { createBraflixProvider } from "./braflix";
import { createAllAnimeProvider } from "./allanime";
import { createCinebyAnimeProvider } from "./cineby-anime";

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: "vidking",
    metadata: {
      id: "vidking",
      name: "VidKing",
      description: "VidKing (recommended)",
      recommended: true,
      isAnimeProvider: false,
    },
    capabilities: { contentTypes: ["movie", "series"] },
    factory: createVidKingProvider,
  },
  {
    id: "cineby",
    metadata: {
      id: "cineby",
      name: "Cineby",
      description: "Cineby",
      recommended: false,
      isAnimeProvider: false,
    },
    capabilities: { contentTypes: ["movie", "series"] },
    factory: createCinebyProvider,
  },
  {
    id: "bitcine",
    metadata: {
      id: "bitcine",
      name: "BitCine",
      description: "BitCine (Cineby mirror)",
      recommended: false,
      isAnimeProvider: false,
    },
    capabilities: { contentTypes: ["movie", "series"] },
    factory: createBitCineProvider,
  },
  {
    id: "braflix",
    metadata: {
      id: "braflix",
      name: "Braflix",
      description: "Braflix (braflix.mov, no browser for metadata)",
      recommended: false,
      isAnimeProvider: false,
    },
    capabilities: { contentTypes: ["movie", "series"] },
    factory: createBraflixProvider,
  },
  {
    id: "allanime",
    metadata: {
      id: "allanime",
      name: "AllAnime",
      description: "AllAnime / AllManga (anime, sub & dub, no browser needed)",
      recommended: false,
      isAnimeProvider: true,
    },
    capabilities: { contentTypes: ["series"] },
    factory: createAllAnimeProvider,
  },
  {
    id: "cineby-anime",
    metadata: {
      id: "cineby-anime",
      name: "Cineby Anime",
      description: "Cineby Anime (HiAnime search, Playwright stream, sub & dub)",
      recommended: false,
      isAnimeProvider: true,
    },
    capabilities: { contentTypes: ["series"] },
    factory: createCinebyAnimeProvider,
  },
];
