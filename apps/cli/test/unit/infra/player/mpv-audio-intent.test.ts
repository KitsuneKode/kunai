import { expect, test } from "bun:test";

import { parseMpvAudioIntent } from "@/infra/player/mpv-audio-intent";

const path = "https://example.test/current.mkv";
const payload = (language: string) => JSON.stringify({ id: 2, language, path });

test.each([
  ["jpn", "ja"],
  [" ENG ", "en"],
  ["fra", "fr"],
  ["por_BR", "pt-br"],
  ["zho-Hans", "zh-hans"],
  ["fil", "fil"],
  ["en", "en"],
])("normalizes mpv language %s to session language %s", (language, expected) => {
  expect(parseMpvAudioIntent(payload(language), path)?.audioLanguageIntent).toBe(expected);
});

test("refuses indeterminate, malformed and stale-media language intent", () => {
  for (const language of ["und", "und-US", "mul", "zxx", "", "en--US", "en-123456789"]) {
    expect(parseMpvAudioIntent(payload(language), path)).toBeNull();
  }
  expect(parseMpvAudioIntent(payload("jpn"), "https://example.test/replaced.mkv")).toBeNull();
});
