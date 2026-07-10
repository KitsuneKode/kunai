import { expect, test } from "bun:test";

import { resolveTitleProviderLane, titleMatchesShellMode } from "@/domain/provider-lane-contract";
import { streamRequestToResolveInput } from "@/services/providers/stream-request-adapter";

test("classifies YouTube identities as the YouTube provider lane", () => {
  expect(
    resolveTitleProviderLane({
      id: "youtube:dQw4w9WgXcQ",
    }),
  ).toBe("youtube");
});

test("rejects YouTube identities outside YouTube mode", () => {
  const title = {
    id: "youtube:dQw4w9WgXcQ",
  };

  expect(titleMatchesShellMode(title, "youtube")).toBe(true);
  expect(titleMatchesShellMode(title, "series")).toBe(false);
  expect(titleMatchesShellMode(title, "anime")).toBe(false);
});

test("classifies explicit anime titles as the anime provider lane", () => {
  expect(resolveTitleProviderLane({ id: "anilist:1", isAnime: true })).toBe("anime");
});

test("refuses to construct a series resolve request for a YouTube title", () => {
  expect(() =>
    streamRequestToResolveInput(
      {
        title: { id: "youtube:dQw4w9WgXcQ", type: "series", name: "Demo" },
        audioPreference: "original",
        subtitlePreference: "none",
      },
      "series",
    ),
  ).toThrow("youtube lane");
});
