import { defineProviderManifest } from "@kunai/core";

export const VIDROCK_PROVIDER_ID = "vidrock" as const;

export const vidrockManifest = defineProviderManifest({
  id: VIDROCK_PROVIDER_ID,
  displayName: "VidRock",
  aliases: ["Granite", "P-Stream"],
  description: "Backup source for movies and series with direct video files",
  domain: "vidrock.net",
  recommended: true,
  mediaKinds: ["movie", "series"],
  capabilities: ["source-resolve", "multi-source", "quality-ranked"],
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
      VIDROCK_PROVIDER_ID,
      "media-kind",
      "title",
      "season",
      "episode",
      "audio",
      "subtitle",
      "quality",
      "startup",
      "source",
      "stream",
    ],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: true,
  relayProfile: {
    upstreamHosts: ["vidrock.net"],
  },
  notes: [
    "Browserless fallback: GET vidrock.net/api/{movie|tv}/… returns a map of",
    "server lanes whose url fields are AES-256-GCM ciphertexts; each decrypts",
    "to a direct HLS URL. Streams carry a current-Chrome User-Agent plus the",
    "vidrock.net Referer and Origin — since 2026-10-13 the CDN hosts 403/404,",
    "serve Cloudflare challenges, or return wrong content to the old",
    "single-space UA. A resolve-gate probe filters lanes the headers cannot",
    "save; an all-null lane map is an upstream outage (title miss), while",
    "all-decrypt-failed is key rotation — the failure codes tell them apart.",
  ],
});
