import { defineProviderManifest } from "@kunai/core";

export const MIRURO_PROVIDER_ID = "miruro" as const;

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description: "Miruro anime direct resolver (pipe API + XOR decrypt)",
  domain: "miruro.tv",
  recommended: true,
  mediaKinds: ["anime"],
  capabilities: ["source-resolve", "multi-source", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "health-check"],
      browserSafe: false,
      relaySafe: true,
      localOnly: false,
    },
  ],
  cachePolicy: {
    ttlClass: "stream-manifest",
    scope: "local",
    keyParts: ["provider", MIRURO_PROVIDER_ID, "media-kind", "title", "episode", "audio"],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: true,
  status: "candidate",
  notes: [
    "Uses miruro.tv pipe API with XOR/gzip decryption key 71951034f8fbcf53d89db52ceb3dc22c.",
    "Sources from vault-10.uwucdn.top CDN with referer from stream payload.",
    "May hit Cloudflare rate limits if called too frequently.",
  ],
});
