import { defineProviderManifest } from "@kunai/core";

export const ANIDAP_PROVIDER_ID = "anidap" as const;

export const anidapManifest = defineProviderManifest({
  id: ANIDAP_PROVIDER_ID,
  displayName: "Anidap",
  aliases: ["anidap.lol"],
  description: "Anime episodes in sub and dub through Anidap's catalog and server slots",
  domain: "anidap.lol",
  recommended: false,
  mediaKinds: ["anime"],
  catalogIdentity: "anilist",
  capabilities: [
    "search",
    "episode-list",
    "source-resolve",
    "subtitle-resolve",
    "multi-source",
    "quality-ranked",
  ],
  runtimePorts: [
    {
      runtime: "direct-http",
      operations: [
        "search",
        "list-episodes",
        "resolve-stream",
        "resolve-subtitles",
        "health-check",
      ],
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
      ANIDAP_PROVIDER_ID,
      "anime",
      "title",
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
    upstreamHosts: ["graphql.anidap.lol", "chad.anidap.lol"],
  },
  notes: [
    "Browserless catalog path: GraphQL anime/searchAnime resolves AniList or title identity to the provider slug; chad.anidap.lol carries episodes, server slots, and source payloads.",
    "Sub and dub provider slots stay separate. Provider-supplied media headers ride the exact stream candidate into the shared resolve gate.",
    "Some Anidap slots share AnimeX/aniwatch infrastructure; backend independence is documented in the dossier rather than overstated.",
  ],
});
