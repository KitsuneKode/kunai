import { describe, expect, test } from "bun:test";

import { persistLanguageHintsFromEnqueueInput } from "@/services/download/download-language-hints";

describe("persistLanguageHintsFromEnqueueInput", () => {
  test("maps anime audio dub and subtitle", () => {
    expect(
      persistLanguageHintsFromEnqueueInput({
        mode: "anime",
        audioPreference: "dub",
        subtitlePreference: "en",
      }),
    ).toEqual({ subLang: "en", animeLang: "dub" });
  });

  test("maps anime english audio to the dub catalog", () => {
    expect(
      persistLanguageHintsFromEnqueueInput({
        mode: "anime",
        audioPreference: "en",
        subtitlePreference: "en",
      }),
    ).toEqual({ subLang: "en", animeLang: "dub" });
  });

  test("defaults anime sub stream when audio is not dub", () => {
    expect(
      persistLanguageHintsFromEnqueueInput({
        mode: "anime",
        audioPreference: "original",
        subtitlePreference: "none",
      }),
    ).toEqual({ subLang: "none", animeLang: "sub" });
  });

  test("series mode only persists subtitle code", () => {
    expect(
      persistLanguageHintsFromEnqueueInput({
        mode: "series",
        audioPreference: "original",
        subtitlePreference: "en",
      }),
    ).toEqual({ subLang: "en" });
  });
});
