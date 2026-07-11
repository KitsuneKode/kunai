import { defineProviderManifest } from "@kunai/core";

export const MIRURO_PROVIDER_ID = "miruro" as const;

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description: "Miruro anime direct resolver (pipe API + XOR decrypt)",
  domain: "miruro.bz",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "anilist",
  capabilities: ["episode-list", "source-resolve", "multi-source", "quality-ranked"],
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
    keyParts: [
      "provider",
      MIRURO_PROVIDER_ID,
      "media-kind",
      "title",
      "episode",
      "audio",
      "quality",
      "startup",
      "source",
      "stream",
    ],
    allowStale: true,
  },
  browserSafe: false,
  relaySafe: true,
  relayProfile: {
    upstreamHosts: ["miruro.bz", "miruro.ru"],
  },
  status: "candidate",
  notes: [
    "Demoted from default anime fallback (2026-07-11): pipe endpoint returns WAF 403 HTML from this environment.",
    "Active mirrors: miruro.bz, miruro.ru. TLS-dead miruro.tv hosts removed from the resolve list.",
    "Uses Miruro pipe API with XOR/gzip decryption key 71951034f8fbcf53d89db52ceb3dc22c.",
    "May hit Cloudflare rate limits if called too frequently.",
  ],
});
