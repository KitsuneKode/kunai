import { defineProviderManifest } from "./factory";

export const MIRURO_PROVIDER_ID = "miruro" as const;

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description: "Miruro 0-RAM backend resolver (theanimecommunity.com)",
  domain: "miruro.tv",
  recommended: true,
  mediaKinds: ["anime"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "node-fetch",
      operations: ["resolve-stream", "health-check"],
      browserSafe: true, // It hits a clean API, safe for CORS if configured
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: [
      "provider",
      MIRURO_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
      "subtitle",
    ],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: true,
  status: "production",
  notes: [
    "Completely bypasses Miruro frontend Cloudflare by hitting theanimecommunity.com with raw AniList IDs."
  ],
});