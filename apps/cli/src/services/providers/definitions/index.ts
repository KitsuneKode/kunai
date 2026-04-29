// =============================================================================
// Provider Definitions Registry
//
// Export all provider definitions for the registry.
// Adding a provider = 1 file in this directory + 1 export here.
// =============================================================================

import type { ProviderDefinition } from "../Provider";
import {
  allanimeManifest,
  bitcineManifest,
  braflixManifest,
  cinebyAnimeManifest,
  cinebyManifest,
  vidkingManifest,
} from "@kunai/core";
import { createVidKingProvider } from "./vidking";
import { createCinebyProvider } from "./cineby";
import { createBitCineProvider } from "./bitcine";
import { createBraflixProvider } from "./braflix";
import { createAllAnimeProvider } from "./allanime";
import { createCinebyAnimeProvider } from "./cineby-anime";
import {
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: vidkingManifest.id,
    metadata: manifestToProviderMetadata(vidkingManifest),
    capabilities: manifestToProviderCapabilities(vidkingManifest),
    factory: createVidKingProvider,
  },
  {
    id: cinebyManifest.id,
    metadata: manifestToProviderMetadata(cinebyManifest),
    capabilities: manifestToProviderCapabilities(cinebyManifest),
    factory: createCinebyProvider,
  },
  {
    id: bitcineManifest.id,
    metadata: manifestToProviderMetadata(bitcineManifest),
    capabilities: manifestToProviderCapabilities(bitcineManifest),
    factory: createBitCineProvider,
  },
  {
    id: braflixManifest.id,
    metadata: manifestToProviderMetadata(braflixManifest),
    capabilities: manifestToProviderCapabilities(braflixManifest),
    factory: createBraflixProvider,
  },
  {
    id: allanimeManifest.id,
    metadata: manifestToProviderMetadata(allanimeManifest),
    capabilities: manifestToProviderCapabilities(allanimeManifest),
    factory: createAllAnimeProvider,
  },
  {
    id: cinebyAnimeManifest.id,
    metadata: manifestToProviderMetadata(cinebyAnimeManifest),
    capabilities: manifestToProviderCapabilities(cinebyAnimeManifest),
    factory: createCinebyAnimeProvider,
  },
];
