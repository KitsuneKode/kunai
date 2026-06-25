import { defineProviderManifest } from "@kunai/core";

export const YOUTUBE_PROVIDER_ID = "youtube" as const;

export const youtubeManifest = defineProviderManifest({
  id: YOUTUBE_PROVIDER_ID,
  displayName: "YouTube",
  description: "YouTube via Invidious search and yt-dlp playback",
  domain: "youtube.com",
  recommended: true,
  mediaKinds: ["video"],
  catalogIdentity: "provider-native",
  capabilities: ["search", "episode-list", "source-resolve", "quality-ranked"],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: ["resolve-stream", "health-check"],
      browserSafe: true,
      relaySafe: false,
      localOnly: true,
    },
  ],
  cachePolicy: {
    ttlClass: "provider-metadata",
    scope: "local",
    keyParts: ["provider", YOUTUBE_PROVIDER_ID, "video-id"],
    allowStale: true,
  },
  browserSafe: true,
  relaySafe: false,
  status: "production",
  notes: ["Metadata via Invidious/Piped; playback via youtube.com watch URLs and mpv ytdl."],
});
