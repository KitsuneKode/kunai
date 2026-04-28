import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  fetchSubtitlesFromWyzie,
  parseWyzieSubtitleList,
  resolveSubtitlesByTmdbId,
  selectSubtitle,
} from "@/subtitle";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("parseWyzieSubtitleList", () => {
  test("accepts both array payloads and wrapped result objects", () => {
    const entry = {
      id: "1",
      url: "https://sub.wyzie.io/c/demo/id/1?format=srt",
      language: "en",
      display: "English",
      release: "Demo.S01E01",
    };

    expect(parseWyzieSubtitleList([entry])).toEqual([entry]);
    expect(parseWyzieSubtitleList({ subtitles: [entry] })).toEqual([entry]);
    expect(parseWyzieSubtitleList({ tracks: [entry] })).toEqual([entry]);
    expect(parseWyzieSubtitleList({ results: [entry] })).toEqual([entry]);
  });
});

describe("selectSubtitle", () => {
  test("prefers the requested language, then English fallback", () => {
    const english = {
      id: "en",
      url: "https://sub.wyzie.io/c/demo/id/en?format=srt",
      language: "English",
      display: "English",
      release: "Demo",
    };
    const arabic = {
      id: "ar",
      url: "https://sub.wyzie.io/c/demo/id/ar?format=srt",
      language: "ar",
      display: "Arabic",
      release: "Demo",
    };

    expect(selectSubtitle([english, arabic], "ar")?.url).toBe(arabic.url);
    expect(selectSubtitle([english], "fr")?.url).toBe(english.url);
  });
});

describe("fetchSubtitlesFromWyzie", () => {
  test("replays observed wyzie requests and picks the requested language", async () => {
    const captured: { url?: string; headers?: RequestInit["headers"] } = {};
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      captured.url = String(input);
      captured.headers = init?.headers;
      return new Response(
        JSON.stringify([
          {
            id: "1",
            url: "https://sub.wyzie.io/c/demo/id/1?format=srt",
            language: "en",
            display: "English",
            release: "Demo",
          },
          {
            id: "2",
            url: "https://sub.wyzie.io/c/demo/id/2?format=srt",
            language: "ar",
            display: "Arabic",
            release: "Demo",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const result = await fetchSubtitlesFromWyzie(
      "https://sub.wyzie.io/search?id=127529&key=wyzie-secret&season=1&episode=2",
      "ar",
      { referer: "https://www.vidking.net/embed/tv/127529/1/2" },
    );

    expect(captured.url).toContain("sub.wyzie.io/search");
    expect(result.failed).toBe(false);
    expect(result.list).toHaveLength(2);
    expect(result.selected).toBe("https://sub.wyzie.io/c/demo/id/2?format=srt");
  });
});

describe("resolveSubtitlesByTmdbId", () => {
  test("builds the active wyzie series query with season and episode data", async () => {
    let requestedUrl = "";
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify([
          {
            id: "99",
            url: "https://sub.wyzie.io/c/demo/id/99?format=srt",
            language: "en",
            display: "English",
            release: "Bloodhounds.S01E02",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const result = await resolveSubtitlesByTmdbId({
      tmdbId: "127529",
      type: "series",
      season: 1,
      episode: 2,
      preferredLang: "en",
    });

    expect(requestedUrl).toContain("id=127529");
    expect(requestedUrl).toContain("season=1");
    expect(requestedUrl).toContain("episode=2");
    expect(result.failed).toBe(false);
    expect(result.selected).toBe("https://sub.wyzie.io/c/demo/id/99?format=srt");
  });
});
