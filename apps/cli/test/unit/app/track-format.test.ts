import { describe, expect, test } from "bun:test";

import { formatLanguageBadge, formatSourceEvidence } from "@/app/track-format";

describe("track-format seam", () => {
  test("formatLanguageBadge renders normalized language + role", () => {
    expect(formatLanguageBadge({ language: "en", role: "subtitle" })).toBe("EN subs");
    expect(formatLanguageBadge({ language: "ja", role: "audio" })).toBe("JA audio");
    expect(formatLanguageBadge({ language: "en", role: "hardsub" })).toBe("EN hardsub");
  });
  test("formatSourceEvidence renders native label/host, never as a language", () => {
    expect(formatSourceEvidence({ nativeLabel: "vidstream", host: "zoro" })).toBe(
      "vidstream · zoro",
    );
    expect(formatSourceEvidence({ host: "vidsrc.to" })).toBe("vidsrc.to");
    expect(formatSourceEvidence({})).toBe("");
  });
});
