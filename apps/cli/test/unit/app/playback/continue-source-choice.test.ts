import { describe, expect, test } from "bun:test";

import {
  offerContinueSourceChoice,
  shouldOfferContinueSourcePrompt,
} from "@/app/playback/continue-source-choice";
import type { Container } from "@/container";
import type { EpisodeInfo, TitleInfo } from "@/domain/types";

const TITLE: TitleInfo = { id: "tmdb:1", type: "series", name: "Demo" };
const EPISODE: EpisodeInfo = { season: 1, episode: 2 };

function container(preference: string, online = true): Container {
  // SAFETY: deliberately partial test stub — the helper only reads these two members.
  return {
    config: { continueSourcePreference: preference },
    connectivity: { isOnline: () => online },
  } as Container;
}

describe("shouldOfferContinueSourcePrompt", () => {
  test("arms explicit continue launches and direct resume selections", () => {
    expect(
      shouldOfferContinueSourcePrompt({
        launchSource: "continue",
        startAt: 0,
        suppressResumePrompt: false,
      }),
    ).toBe(true);
    expect(
      shouldOfferContinueSourcePrompt({
        launchSource: "search",
        startAt: 612,
        suppressResumePrompt: true,
      }),
    ).toBe(true);
  });

  test("does not arm ordinary playback, offline launches, or a source the user already chose", () => {
    expect(
      shouldOfferContinueSourcePrompt({
        launchSource: "search",
        startAt: 0,
        suppressResumePrompt: false,
      }),
    ).toBe(false);
    expect(
      shouldOfferContinueSourcePrompt({
        launchSource: "continue",
        startAt: 0,
        suppressResumePrompt: false,
        playbackSourceOverride: "online",
      }),
    ).toBe(false);
    expect(
      shouldOfferContinueSourcePrompt({
        launchSource: "offline-library",
        startAt: 612,
        suppressResumePrompt: true,
      }),
    ).toBe(false);
  });
});

describe("offerContinueSourceChoice", () => {
  test("asks when Continue has both a ready download and an online route", async () => {
    const asked: string[] = [];
    const result = await offerContinueSourceChoice({
      container: container("ask"),
      title: TITLE,
      episode: EPISODE,
      hasReadyLocal: async () => true,
      choose: async () => {
        asked.push("asked");
        return "local";
      },
    });

    expect(result).toBe("local");
    expect(asked).toEqual(["asked"]);
  });

  test("does not ask for Auto, without a download, or without an online route", async () => {
    for (const input of [
      { container: container("auto"), hasReadyLocal: async () => true },
      { container: container("ask"), hasReadyLocal: async () => false },
      { container: container("ask", false), hasReadyLocal: async () => true },
    ]) {
      let asked = false;
      const result = await offerContinueSourceChoice({
        ...input,
        title: TITLE,
        episode: EPISODE,
        choose: async () => {
          asked = true;
          return "local";
        },
      });
      expect(result).toBe("not-needed");
      expect(asked).toBe(false);
    }
  });

  test("a non-interactive Ask falls back to streaming instead of blocking", async () => {
    const result = await offerContinueSourceChoice({
      container: container("ask"),
      title: TITLE,
      episode: EPISODE,
      hasReadyLocal: async () => true,
      interactive: false,
    });

    expect(result).toBe("online");
  });
});
