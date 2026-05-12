import { defineProviderManifest } from "@kunai/core";

export const MIRURO_PROVIDER_ID = "miruro" as const;

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description: "Miruro anime direct resolver candidate (theanimecommunity.com)",
  domain: "miruro.tv",
  recommended: true,
  mediaKinds: ["anime"],
  capabilities: ["source-resolve", "subtitle-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "health-check"],
      browserSafe: true,
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
  status: "candidate",
  notes: [
    "Completely bypasses Miruro frontend Cloudflare by hitting theanimecommunity.com with raw AniList IDs.",
  ],
});
