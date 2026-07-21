import { expect, test } from "bun:test";

import { resolvePlaybackProviderHandoff } from "@/app/playback/playback-provider-handoff";

test("successful fallback owns playback-cycle consumers", () => {
  expect(
    resolvePlaybackProviderHandoff({
      configuredProviderId: "vidking",
      successfulProviderId: "rivestream",
    }),
  ).toEqual({
    configuredProviderId: "vidking",
    successfulProviderId: "rivestream",
    historyProviderId: "rivestream",
    presenceProviderId: "rivestream",
    shareProviderId: "rivestream",
    nextEpisodeProviderId: "rivestream",
  });
});

test("configured and successful remain distinct when they match", () => {
  expect(
    resolvePlaybackProviderHandoff({
      configuredProviderId: "vidking",
      successfulProviderId: "vidking",
    }),
  ).toEqual({
    configuredProviderId: "vidking",
    successfulProviderId: "vidking",
    historyProviderId: "vidking",
    presenceProviderId: "vidking",
    shareProviderId: "vidking",
    nextEpisodeProviderId: "vidking",
  });
});
