// =============================================================================
// Provider Definitions Registry
//
// Export all provider definitions for the registry.
// Adding a provider = 1 file in this directory + 1 export here.
// =============================================================================

import { allanimeManifest, miruroManifest, rivestreamManifest, vidkingManifest } from "@kunai/core";

import type { ProviderDefinition } from "../Provider";
import { createAllMangaCompatProvider } from "./allanime";
import { createMiruroProvider } from "./miruro";
import { createRivestreamProvider } from "./rivestream";
import { createVidKingProvider } from "./vidking";

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    id: rivestreamManifest.id,
    manifest: rivestreamManifest,
    factory: createRivestreamProvider,
  },
  {
    id: vidkingManifest.id,
    manifest: vidkingManifest,
    factory: createVidKingProvider,
  },
  {
    id: allanimeManifest.id,
    manifest: allanimeManifest,
    factory: createAllMangaCompatProvider,
  },
  {
    id: miruroManifest.id,
    manifest: miruroManifest,
    factory: createMiruroProvider,
  },
];
