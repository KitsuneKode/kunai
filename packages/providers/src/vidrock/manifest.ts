import { defineProviderManifest } from "@kunai/core";

export const VIDROCK_PROVIDER_ID = "vidrock" as const;

export const vidrockManifest = defineProviderManifest({
  id: VIDROCK_PROVIDER_ID,
  displayName: "VidRock",
  aliases: ["Granite", "P-Stream"],
  description: "Backup source for movies and series with direct video files",
  domain: "vidrock.net",
  recommended: false,
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
    "to a direct HLS URL. Streams carry a single-space User-Agent — the ngcorp",
    "segment hosts drop connections that send a real UA, and ' ' is the only",
    "value ffmpeg can emit that passes. A resolve-gate probe filters TLS-gated",
    "lanes (workers.dev, CF-challenged .lol/.site hosts) that mpv cannot play.",
  ],
});
