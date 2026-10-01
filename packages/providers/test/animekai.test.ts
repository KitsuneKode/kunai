import { describe, expect, test } from "bun:test";

import {
  animekaiFilterResultsByQueryWords,
  animekaiLongestWordFallback,
  animekaiMalIdFromEmbedUrl,
  animekaiSourcesEndpoint,
  AnimekaiEmbedDecodeError,
  chooseAnimekaiSearchMatch,
  decryptAnimekaiSourcesBlob,
  looksLikeAnimekaiShowId,
  parseAnimekaiEmbedDataId,
  parseAnimekaiEpisodesHtml,
  parseAnimekaiSearchHtml,
  parseAnimekaiServersJson,
  parseAnimekaiSourcesJson,
} from "../src/animekai/direct";
import { animekaiMasterUrlFromDecrypted } from "../src/animekai/embed";

const SEARCH_HTML = `
<div class="aitem">
    <div class="inner">
        <a href="https://animekai.be/watch/naruto-shippuden" class="poster">
            <div><img src="x.jpg" alt="Naruto Shippuden" loading="lazy"></div>
        </a>
        <a class="title" href="https://animekai.be/watch/naruto-shippuden" title="Naruto Shippuden"
            data-jp="Naruto: Shippuuden">Naruto Shippuden</a>
        <div class="info">
            <span class="sub"><svg></svg>500</span>
            <span class="dub"><svg></svg>500</span>
            <span><b>TV</b></span>
        </div>
    </div>
</div>
<div class="aitem">
    <div class="inner">
        <a href="https://animekai.be/watch/naruto" class="poster"></a>
        <a class="title" href="https://animekai.be/watch/naruto" title="Naruto" data-jp="Naruto">Naruto</a>
        <div class="info">
            <span class="sub"><svg></svg>220</span>
            <span class="dub"><svg></svg>220</span>
        </div>
    </div>
</div>
`;

describe("animekai search parsing", () => {
  test("extracts slug, title, data-jp, and per-mode counts per aitem", () => {
    const results = parseAnimekaiSearchHtml(SEARCH_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "naruto-shippuden",
      title: "Naruto Shippuden",
      nativeTitle: "Naruto: Shippuuden",
      subCount: 500,
      dubCount: 500,
    });
    expect(results[1]?.id).toBe("naruto");
  });

  test("a non-aitem page returns no results rather than noise", () => {
    expect(parseAnimekaiSearchHtml("<html><body>nope</body></html>")).toHaveLength(0);
  });
});

describe("animekai match picking", () => {
  const results = parseAnimekaiSearchHtml(SEARCH_HTML);

  test("exact title wins", () => {
    expect(chooseAnimekaiSearchMatch("Naruto", results)?.id).toBe("naruto");
  });

  // The ani-cli parity case: AniList hands Kunai romaji titles, which live in
  // data-jp while `title` holds the English display name.
  test("romaji queries match data-jp, not just the display title", () => {
    const match = chooseAnimekaiSearchMatch("Naruto: Shippuuden", results);
    expect(match?.id).toBe("naruto-shippuden");
  });

  test("prefix relationships beat document order", () => {
    const prefixed = chooseAnimekaiSearchMatch("Naruto Shippuden", results);
    expect(prefixed?.id).toBe("naruto-shippuden");
  });
});

describe("animekai longest-word search fallback", () => {
  test("single-word queries have no fallback", () => {
    expect(animekaiLongestWordFallback("naruto")).toBeNull();
  });

  test("multi-word queries retry on the longest word", () => {
    expect(animekaiLongestWordFallback("cyberpunk edgerunners")).toBe("edgerunners");
  });

  test("the client filter keeps results containing every query word", () => {
    const widened = parseAnimekaiSearchHtml(SEARCH_HTML);
    const filtered = animekaiFilterResultsByQueryWords(widened, "shippuden naruto");
    expect(filtered.map((r) => r.id)).toEqual(["naruto-shippuden"]);
  });

  test("words absent from both names drop the result", () => {
    const widened = parseAnimekaiSearchHtml(SEARCH_HTML);
    expect(animekaiFilterResultsByQueryWords(widened, "naruto boruto").map((r) => r.id)).toEqual(
      [],
    );
  });
});

const EPISODES_HTML = `
<div class="eplist titles">
  <ul class="range" data-range="001-100">
    <li>
      <a href="https://animekai.be/watch/naruto/ep-1"
         num="1" data-sub="1" data-dub="1" langs="3" class="active">
         1 <span data-jp="Enter Naruto"></span>
      </a>
    </li>
    <li>
      <a href="https://animekai.be/watch/naruto/ep-2"
         num="2" data-sub="1" data-dub="0" langs="2">
         2 <span data-jp="Sasuke"></span>
      </a>
    </li>
    <li>
      <a href="https://animekai.be/watch/other-show/ep-9" num="9" data-sub="1" data-dub="1">9</a>
    </li>
  </ul>
</div>
`;

describe("animekai episode parsing", () => {
  test("reads num plus per-mode availability flags", () => {
    const entries = parseAnimekaiEpisodesHtml(EPISODES_HTML, "naruto");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ number: 1, sub: true, dub: true, langs: 3 });
    expect(entries[1]).toMatchObject({ number: 2, sub: true, dub: false });
  });

  test("anchors for a different show are skipped", () => {
    const entries = parseAnimekaiEpisodesHtml(EPISODES_HTML, "other-show");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.number).toBe(9);
  });

  test("a page with no episode anchors is empty (markup-moved case is detected upstream)", () => {
    expect(parseAnimekaiEpisodesHtml("<div>nothing</div>", "naruto")).toHaveLength(0);
  });
});

describe("animekai servers payload", () => {
  const SERVERS_JSON = {
    episode: { id: 2246, number: 1, title_english: "Episode 1" },
    sources: {
      sub: [
        {
          id: 6042,
          server_name: "Server 1",
          source_url: "https://megaplay.buzz/stream/mal/20/1/sub",
        },
        {
          id: 6043,
          server_name: "Server 2",
          source_url: "https://megaplay.buzz/stream/mal/20/1/sub",
        },
      ],
      dub: [
        {
          id: 6482,
          server_name: "Server 1",
          source_url: "https://megaplay.buzz/stream/mal/20/1/dub",
        },
      ],
    },
  };

  test("splits servers by mode and keeps order", () => {
    const entries = parseAnimekaiServersJson(SERVERS_JSON);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.audioMode)).toEqual(["sub", "sub", "dub"]);
    expect(entries[0]?.serverName).toBe("Server 1");
  });

  test("drops entries without an http embed url", () => {
    const entries = parseAnimekaiServersJson({
      sources: {
        sub: [
          { server_name: "Broken", source_url: "javascript:void(0)" },
          { server_name: "Fine", source_url: "https://megaplay.buzz/stream/mal/1/1/sub" },
        ],
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.serverName).toBe("Fine");
  });

  test("a malformed envelope parses to nothing", () => {
    expect(parseAnimekaiServersJson("not json object")).toHaveLength(0);
    expect(parseAnimekaiServersJson({})).toHaveLength(0);
  });
});

describe("animekai getSources payload", () => {
  test("reads enc, tracks, and intro/outro segments", () => {
    const payload = parseAnimekaiSourcesJson({
      enc: "abc123_-",
      tracks: [
        {
          file: "https://subs.example/eng-2.vtt",
          label: "English",
          kind: "captions",
          default: true,
        },
        { file: "not-a-url", label: "Bad" },
      ],
      intro: { start: 0, end: 0 },
      outro: { start: 1280, end: 1369 },
      server: 4,
    });
    expect(payload?.enc).toBe("abc123_-");
    // The zero-length intro is dropped; only real segments ship.
    expect(payload?.intro).toBeUndefined();
    expect(payload?.outro).toEqual({ start: 1280, end: 1369 });
    expect(payload?.tracks).toHaveLength(1);
    expect(payload?.tracks[0]?.isDefault).toBe(true);
  });

  test("a payload with no enc is unusable", () => {
    expect(parseAnimekaiSourcesJson({ tracks: [] })).toBeNull();
  });
});

describe("animekai embed helpers", () => {
  test("data-id comes off the embed page", () => {
    expect(parseAnimekaiEmbedDataId(`<html data-id="104103"></html>`)).toBe("104103");
    expect(parseAnimekaiEmbedDataId(`<div>none</div>`)).toBeNull();
  });

  test("mal id rides in the embed path for skip metadata", () => {
    expect(animekaiMalIdFromEmbedUrl("https://megaplay.buzz/stream/mal/20/1/sub")).toBe("20");
    expect(animekaiMalIdFromEmbedUrl("https://megaplay.buzz/stream/other")).toBeUndefined();
  });

  test("getSources lives on the embed origin and answers only ajax", () => {
    expect(animekaiSourcesEndpoint("https://megaplay.buzz/stream/mal/20/1/sub", "104103")).toBe(
      "https://megaplay.buzz/stream/getSources?id=104103",
    );
  });

  test("slug guard accepts kebab ids", () => {
    expect(looksLikeAnimekaiShowId("naruto-shippuden")).toBe(true);
    expect(looksLikeAnimekaiShowId("")).toBe(false);
  });
});

describe("animekai AES-CBC sources decrypt", () => {
  // Fixture encrypted with the same constants the embed ships: key
  // "i?LMTAx0Q6,:}50U" zero-padded to 32 bytes, iv "W0;27ToaUpl_P%'c".
  async function encryptFixture(json: string): Promise<string> {
    const keyBytes = new Uint8Array(32);
    keyBytes.set(new TextEncoder().encode("i?LMTAx0Q6,:}50U"));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
      "encrypt",
    ]);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: new TextEncoder().encode("W0;27ToaUpl_P%'c") },
      key,
      new TextEncoder().encode(json),
    );
    return Buffer.from(cipher).toString("base64url");
  }

  test("decrypts the embed's enc blob into the playlist payload", async () => {
    const enc = await encryptFixture(
      '{"file":"https:\\/\\/fetch.nexabloom.top\\/anime\\/abc\\/master.m3u8"}',
    );
    const decrypted = await decryptAnimekaiSourcesBlob(enc);
    expect(animekaiMasterUrlFromDecrypted(decrypted)).toBe(
      "https://fetch.nexabloom.top/anime/abc/master.m3u8",
    );
  });

  test("a garbage blob is a typed decode failure, not a raw crypto error", async () => {
    await expect(decryptAnimekaiSourcesBlob("%%%not-base64%%%")).rejects.toMatchObject({
      code: "decrypt-failed",
    } satisfies Partial<AnimekaiEmbedDecodeError>);
  });
});
