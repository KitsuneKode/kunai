import { defineProviderManifest } from "@kunai/core";

export const MIRURO_PROVIDER_ID = "miruro" as const;

export const miruroManifest = defineProviderManifest({
  id: MIRURO_PROVIDER_ID,
  displayName: "Miruro",
  description: "Alternate anime source — useful when a title is missing elsewhere",
  domain: "www.miruro.bz",
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
    upstreamHosts: ["www.miruro.bz", "www.miruro.ru", "miruro.bz", "miruro.ru"],
  },
  status: "candidate",
  notes: [
    "2026-07-16: Browser network on www.miruro.bz/watch/{anilistId}/... uses GET /api/secure/pipe?e=… (200 plain + x-obfuscated). HLS on vault*.ultracloud / owocdn with stream.referer https://kwik.cx/.",
    "Bun fetch often gets CF 403 HTML on pipe; production path falls back to curl --http2 with browser headers (dossier-proven on this machine).",
    "Primary hosts: www.miruro.bz, www.miruro.ru. TLS-dead miruro.tv hosts stay off the resolve list.",
    "Uses Miruro pipe API with XOR/gzip decryption key 71951034f8fbcf53d89db52ceb3dc22c.",
    "Still not the default anime auto-fallback (AllAnime remains primary); Miruro is available for manual pick when curl/http2 path works.",
    "May hit Cloudflare rate limits if called too frequently.",
  ],
});
