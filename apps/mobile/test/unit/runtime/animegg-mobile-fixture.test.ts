import { describe, expect, test } from "bun:test";

import { animeggProviderModule } from "../../../../../packages/providers/src/animegg/direct.ts";
import { createStreamId } from "../../../../../packages/providers/src/shared/source-inventory.ts";
import type {
  ProviderFetchPort,
  ProviderRuntimeHost,
} from "../../../../../packages/types/src/index.ts";

const SEARCH_HTML = `
<a href="/series/one-piece" class="mse"><div class="media-body"><div class="first"><h2>One Piece</h2>
<p class="infoami"><div>Episodes: 1161</div><div>Alt Titles : ONE PIECE </div>
<div>Status : Ongoing</div></p></div></div></a>
`;

const EPISODE_HTML = `
<a data-id='25881' data-mirror="Animegg" data-version="subbed"></a>
`;

const EMBED_HTML = `
<script>
var videoSources = [{file: "/play/548902/video.mp4?for=101789115911127", label: "1080p", bk: "aHR0cCUzQQ==", isBk: false }];
</script>
`;

const PLAY_FILE = "/play/548902/video.mp4?for=101789115911127";

function fixtureFetch(): ProviderFetchPort {
  const pages = new Map<string, string>([
    ["https://www.animegg.org/search/?q=one%20piece", SEARCH_HTML],
    ["https://www.animegg.org/one-piece-episode-1", EPISODE_HTML],
    ["https://www.animegg.org/embed/25881", EMBED_HTML],
  ]);
  return {
    runtime: "direct-http",
    resolvesLocally: false,
    async fetch(input, init) {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "HEAD" || url.includes("/play/")) {
        return new Response(null, { status: 200 });
      }
      const body = pages.get(url);
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    },
  };
}

function hostFake(label: "android" | "ashell"): ProviderRuntimeHost {
  return {
    which: () => null,
    sleep: async () => {},
    hash: async () => `${label}-hash`,
    gzip: async (bytes) => bytes,
    gunzip: async (bytes) => bytes,
    spawn: async () => {
      throw new Error(`${label} has no curl-impersonate`);
    },
  };
}

describe("AnimeGG on a mobile runtime", () => {
  for (const label of ["android", "ashell"] as const) {
    test(`search and resolve succeed against the ${label} host fake`, async () => {
      const context = {
        providerId: "animegg" as const,
        host: hostFake(label),
        fetch: fixtureFetch(),
        now: () => "2026-10-01T00:00:00.000Z",
      };
      const found = await animeggProviderModule.search?.({ query: "one piece" }, context);
      expect(found?.[0]).toMatchObject({
        id: "one-piece",
        title: "One Piece",
        externalIds: { providerNativeIds: { animegg: "one-piece" } },
      });

      const resolved = await animeggProviderModule.resolve(
        {
          title: {
            id: "animegg:one-piece",
            kind: "anime",
            title: "One Piece",
            externalIds: { providerNativeIds: { animegg: "one-piece" } },
          },
          episode: { episode: 1 },
          mediaKind: "anime",
          intent: "play",
          allowedRuntimes: ["direct-http"],
        },
        context,
      );

      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;
      expect(resolved.selectedStreamId).toBe(
        createStreamId("animegg", ["one-piece", 1, "sub", PLAY_FILE]),
      );
      expect(resolved.streams[0]?.url).toBe(`https://www.animegg.org${PLAY_FILE}`);
    });
  }
});
