// =============================================================================
// Provider Definitions Registry
//
// Export all provider definitions for the registry.
// Adding a provider = 1 file in this directory + 1 export here.
// =============================================================================

import { allanimeManifest, miruroManifest, rivestreamManifest, vidkingManifest } from "@kunai/core";

import {
  manifestToProviderCapabilities,
  manifestToProviderMetadata,
} from "../core-manifest-adapter";
import type { ProviderDefinition } from "../Provider";
import { createAllMangaCompatProvider } from "./allanime";
import { createMiruroProvider } from "./miruro";
import { createRivestreamProvider } from "./rivestream";
import { createVidKingProvider } from "./vidking";

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: rivestreamManifest.id,
    metadata: manifestToProviderMetadata(rivestreamManifest),
    capabilities: manifestToProviderCapabilities(rivestreamManifest),
    factory: createRivestreamProvider,
  },
  {
    id: vidkingManifest.id,
    metadata: manifestToProviderMetadata(vidkingManifest),
    capabilities: manifestToProviderCapabilities(vidkingManifest),
    factory: createVidKingProvider,
  },
  {
    id: allanimeManifest.id,
    metadata: manifestToProviderMetadata(allanimeManifest),
    capabilities: manifestToProviderCapabilities(allanimeManifest),
    factory: createAllMangaCompatProvider,
  },
  {
    id: miruroManifest.id,
    metadata: manifestToProviderMetadata(miruroManifest),
    capabilities: manifestToProviderCapabilities(miruroManifest),
    factory: createMiruroProvider,
  },
];
