import { beforeEach, afterEach, describe, expect, spyOn, test } from "bun:test";

import type { JsonValue } from "@kunai/types";

import { markInvidiousInstanceFailure } from "../../src/youtube/invidious-instance-pool";
import {
  fetchGoogleYoutubeSuggestions,
  fetchYoutubeSearchSuggestions,
} from "../../src/youtube/youtube-suggestions";

function mockFetch() {
  return spyOn(globalThis, "fetch");
}
let fetchMock: ReturnType<typeof mockFetch>;
beforeEach(() => {
  fetchMock = mockFetch();
});
afterEach(() => fetchMock.mockRestore());

function respond(body: JsonValue) {
  fetchMock.mockResolvedValue(Response.json(body));
}

describe("YouTube search suggestions", () => {
  test("empty and aborted queries never make a network call", async () => {
    respond([]);
    expect(await fetchGoogleYoutubeSuggestions("   ")).toEqual([]);
    expect(await fetchYoutubeSearchSuggestions("")).toEqual([]);
    await expect(
      fetchYoutubeSearchSuggestions("lofi", {
        signal: AbortSignal.abort(new Error("cancelled")),
      }),
    ).rejects.toThrow("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("parses query completions and discards malformed entries", async () => {
    respond(["lofi", [" lofi music ", 42, null, "", "lofi radio"]]);
    expect(await fetchGoogleYoutubeSuggestions("lofi")).toEqual(["lofi music", "lofi radio"]);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(new URL(url).searchParams.get("ds")).toBe("yt");
    expect(new URL(url).searchParams.get("q")).toBe("lofi");
  });

  test("a configured Invidious instance receives suggestions without sending the query to Google", async () => {
    respond({ suggestions: ["lofi radio"] });
    expect(
      await fetchYoutubeSearchSuggestions("lofi", {
        preferredInstanceUrl: "https://suggestions.example.test",
      }),
    ).toEqual(["lofi radio"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://suggestions.example.test/api/v1/search/suggestions?q=lofi",
    );
  });

  test("a configured instance failure does not send the draft to a public fallback", async () => {
    fetchMock.mockResolvedValue(Response.json([], { status: 503 }));
    await expect(
      fetchYoutubeSearchSuggestions("private draft", {
        preferredInstanceUrl: "https://unavailable-private.example.test",
      }),
    ).rejects.toThrow("503");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://unavailable-private.example.test/api/v1/search/suggestions?q=private+draft",
    ]);
  });

  test("a configured instance cooldown cannot reroute the next draft", async () => {
    const preferredInstanceUrl = "https://cooling-private.example.test";
    markInvidiousInstanceFailure(preferredInstanceUrl);
    respond({ suggestions: ["private completion"] });
    expect(await fetchYoutubeSearchSuggestions("private", { preferredInstanceUrl })).toEqual([
      "private completion",
    ]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `${preferredInstanceUrl}/api/v1/search/suggestions?q=private`,
    ]);
  });

  test("Google failure falls back to an instance from the directory", async () => {
    fetchMock.mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          const url = String(input);
          if (url.includes("suggestqueries.google.com")) return Response.json({}, { status: 503 });
          if (url.includes("/api/v1/search/suggestions"))
            return Response.json({ suggestions: ["lofi fallback"] });
          return Response.json([
            ["fallback.example.test", { api: true, uri: "https://fallback.example.test" }],
          ]);
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    expect(await fetchYoutubeSearchSuggestions("lofi")).toEqual(["lofi fallback"]);
  });

  test("cancellation during Google fetch never starts a fallback", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    fetchMock.mockRejectedValue(reason);
    const pending = fetchYoutubeSearchSuggestions("lofi", { signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toThrow("cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
