import { describe, expect, it } from "bun:test";

import { playTrailer } from "@/app/search/details-trailer";

describe("playTrailer", () => {
  it("plays the url through the player port", async () => {
    const calls: string[] = [];
    await playTrailer(
      {
        playUrl: async (url) => {
          calls.push(url);
          return true;
        },
        openInBrowser: async () => {},
      },
      "https://yt/abc",
    );
    expect(calls).toEqual(["https://yt/abc"]);
  });

  it("falls back to the browser when the player cannot play", async () => {
    const opened: string[] = [];
    await playTrailer(
      {
        playUrl: async () => false,
        openInBrowser: async (url) => {
          opened.push(url);
        },
      },
      "https://yt/abc",
    );
    expect(opened).toEqual(["https://yt/abc"]);
  });

  it("falls back to the browser when the player throws", async () => {
    const opened: string[] = [];
    await playTrailer(
      {
        playUrl: async () => {
          throw new Error("no yt-dlp");
        },
        openInBrowser: async (url) => {
          opened.push(url);
        },
      },
      "https://yt/abc",
    );
    expect(opened).toEqual(["https://yt/abc"]);
  });

  it("no-ops on an empty url", async () => {
    let touched = false;
    await playTrailer(
      {
        playUrl: async () => {
          touched = true;
          return true;
        },
        openInBrowser: async () => {
          touched = true;
        },
      },
      undefined,
    );
    expect(touched).toBe(false);
  });
});
