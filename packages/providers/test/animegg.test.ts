import { describe, expect, test } from "bun:test";

import { resolveAnimeggSlug, selectAnimeggTab } from "../src/animegg/direct";
import {
  animeggStreamUrl,
  parseAnimeggEmbedSources,
  parseAnimeggEpisodeNumbers,
  parseAnimeggEpisodeTabs,
  parseAnimeggSearchResults,
} from "../src/animegg/site";

/** Trimmed from https://www.animegg.org/search/?q=one+piece on 2026-09-11. */
const SEARCH_HTML = `
<a href="/series/one-piece-episode-of-merry" class="mse"> <div class="media searchre">
<img src="https://vidcache.net:8161/static/692bd0e.jpeg" class="media-object">
<div class="media-body"><div class="first"><h2>One Piece: Episode of Merry</h2>
<p class="infoami"><div>Episodes: 1</div><div>Alt Titles : One Piece Special, ワンピース </div>
<div>Status : Completed</div></p></div></div></div></a>
<a href="/series/one-piece" class="mse"> <div class="media searchre">
<img src="https://vidcache.net:8161/static/80c019e.jpeg" class="media-object">
<div class="media-body"><div class="first"><h2>One Piece</h2>
<p class="infoami"><div>Episodes: 1161</div><div>Alt Titles : ONE PIECE </div>
<div>Status : Ongoing</div></p></div></div></div></a>
`;

/** Trimmed from an episode page's `#videos` tab list. */
const EPISODE_HTML = `
<ul id="videos" class="nav nav-tabs">
<li><a href="#subbed-Animegg" data-toggle="tab" data-id='25881' data-mirror="Animegg" data-version="subbed"><span class="btn-xs btn-subbed">SUBBED</span></a></li>
<li><a href="#dubbed-Animegg" data-toggle="tab" data-id='25882' data-mirror="Animegg" data-version="dubbed"><span class="btn-xs btn-dubbed">DUBBED</span></a></li>
</ul>
<div class="tab-content"><div id="subbed-Animegg" class="tab-pane"><iframe src="/embed/25881"></iframe></div></div>
`;

/** Trimmed from https://www.animegg.org/embed/146867. */
const EMBED_HTML = `
<script>
var videoSources = [{file: "/play/548878/video.mp4?for=101789115911125", label: "480p", bk: "aHR0cCUzQQ==", isBk: false },
{file: "/play/548916/video.mp4?for=101789115911125", label: "720p", bk: "aHR0cCUzQQ==", isBk: false },
{file: "/play/548902/video.mp4?for=101789115911127", label: "1080p", bk: "aHR0cCUzQQ==", isBk: false }];
</script>
`;

describe("parseAnimeggSearchResults", () => {
  test("reads every field the search page exposes", () => {
    const results = parseAnimeggSearchResults(SEARCH_HTML);

    expect(results).toHaveLength(2);
    expect(results[1]).toMatchObject({
      slug: "one-piece",
      title: "One Piece",
      episodeCount: 1161,
      status: "Ongoing",
    });
    expect(results[1]?.posterUrl).toContain("vidcache.net");
  });

  test("keeps alt titles but never repeats the title itself", () => {
    const [merry] = parseAnimeggSearchResults(SEARCH_HTML);
    expect(merry?.altNames).toEqual(["One Piece Special", "ワンピース"]);
    expect(parseAnimeggSearchResults(SEARCH_HTML)[1]?.altNames).toEqual(["ONE PIECE"]);
  });

  test("a page with no results yields none rather than throwing", () => {
    expect(parseAnimeggSearchResults("<html><body>no hits</body></html>")).toEqual([]);
    expect(parseAnimeggSearchResults("")).toEqual([]);
  });

  test("skips an entry with no title instead of inventing one", () => {
    expect(parseAnimeggSearchResults('<a href="/series/x" class="mse"><div></div></a>')).toEqual(
      [],
    );
  });
});

describe("parseAnimeggEpisodeNumbers", () => {
  const html = `
    <a href="/one-piece-episode-1177">1177</a>
    <a href="/one-piece-episode-2">2</a>
    <a href="/one-piece-episode-2">dup</a>
    <a href="/one-piece-film-red-episode-1">related film</a>
  `;

  test("returns this series' episodes, ascending and de-duplicated", () => {
    expect(parseAnimeggEpisodeNumbers(html, "one-piece")).toEqual([2, 1177]);
  });

  test("does not claim another series' episodes as its own", () => {
    // A series page links related shows; matching the slug is what keeps
    // "One Piece Film: Red episode 1" out of One Piece's episode list.
    expect(parseAnimeggEpisodeNumbers(html, "one-piece-film-red")).toEqual([1]);
  });

  test("a slug with regex characters cannot break the match", () => {
    expect(parseAnimeggEpisodeNumbers('<a href="/a.b-episode-3">x</a>', "a.b")).toEqual([3]);
    expect(parseAnimeggEpisodeNumbers('<a href="/axb-episode-3">x</a>', "a.b")).toEqual([]);
  });
});

describe("parseAnimeggEpisodeTabs", () => {
  test("reads the site's own audio labelling rather than guessing", () => {
    expect(parseAnimeggEpisodeTabs(EPISODE_HTML)).toEqual([
      { embedId: "25881", mirror: "Animegg", version: "subbed" },
      { embedId: "25882", mirror: "Animegg", version: "dubbed" },
    ]);
  });

  test("ignores a tab whose version is neither subbed nor dubbed", () => {
    expect(
      parseAnimeggEpisodeTabs(`<a data-id='1' data-mirror="X" data-version="raw"></a>`),
    ).toEqual([]);
  });

  test("an episode with no player yields no tabs", () => {
    expect(parseAnimeggEpisodeTabs("<html></html>")).toEqual([]);
  });
});

describe("parseAnimeggEmbedSources", () => {
  test("reads every quality the embed lists", () => {
    expect(parseAnimeggEmbedSources(EMBED_HTML)).toEqual([
      { file: "/play/548878/video.mp4?for=101789115911125", label: "480p" },
      { file: "/play/548916/video.mp4?for=101789115911125", label: "720p" },
      { file: "/play/548902/video.mp4?for=101789115911127", label: "1080p" },
    ]);
  });

  test("ignores the bk backup, which is not always a playable file", () => {
    // For One Piece it held a direct CDN URL and for Naruto an mp4upload embed
    // page. Treating them alike would hand mpv an HTML document.
    const sources = parseAnimeggEmbedSources(EMBED_HTML);
    expect(JSON.stringify(sources)).not.toContain("aHR0cCUzQQ");
  });

  test("an embed with no sources yields none", () => {
    expect(parseAnimeggEmbedSources("<script>var videoSources = [];</script>")).toEqual([]);
  });
});

describe("animeggStreamUrl", () => {
  test("makes the embed's relative file absolute", () => {
    expect(animeggStreamUrl("/play/1/video.mp4?for=2")).toBe(
      "https://www.animegg.org/play/1/video.mp4?for=2",
    );
  });

  test("refuses a non-http scheme", () => {
    expect(animeggStreamUrl("javascript:alert(1)")).toBeNull();
    expect(animeggStreamUrl("data:text/html,x")).toBeNull();
  });
});

describe("resolveAnimeggSlug", () => {
  const title = (id: string, native?: string) =>
    ({
      id,
      kind: "anime" as const,
      title: "x",
      ...(native ? { externalIds: { providerNativeIds: { animegg: native } } } : {}),
    }) as never;

  test("prefers the stored provider-native slug", () => {
    expect(resolveAnimeggSlug(title("anilist:21", "one-piece"))).toBe("one-piece");
  });

  test("accepts a bare slug as the title id", () => {
    expect(resolveAnimeggSlug(title("death-note"))).toBe("death-note");
  });

  test("refuses another catalog's id rather than guessing a slug", () => {
    // A title found on AniList has no AnimeGG slug; saying so lets the lane fall
    // through to a provider that can resolve it.
    expect(resolveAnimeggSlug(title("anilist:21"))).toBeNull();
    expect(resolveAnimeggSlug(title("tmdb:1399"))).toBeNull();
    expect(resolveAnimeggSlug(title("21"))).toBe("21");
    expect(resolveAnimeggSlug(title("Death Note"))).toBeNull();
  });
});

describe("selectAnimeggTab", () => {
  const tabs = parseAnimeggEpisodeTabs(EPISODE_HTML);

  test("picks the requested audio", () => {
    expect(selectAnimeggTab(tabs, "dub")?.tab.version).toBe("dubbed");
    expect(selectAnimeggTab(tabs, "dub")?.fellBack).toBe(false);
    expect(selectAnimeggTab(tabs, "sub")?.tab.version).toBe("subbed");
    expect(selectAnimeggTab(tabs, "sub")?.fellBack).toBe(false);
  });

  test("falls back to what exists, and says that it did", () => {
    const subOnly = tabs.filter((tab) => tab.version === "subbed");
    const picked = selectAnimeggTab(subOnly, "dub");
    expect(picked?.tab.version).toBe("subbed");
    expect(picked?.fellBack).toBe(true);
  });

  test("no tabs is no stream, not a silent pick", () => {
    expect(selectAnimeggTab([], "sub")).toBeNull();
  });
});
