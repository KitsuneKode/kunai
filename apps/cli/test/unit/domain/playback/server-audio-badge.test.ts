import { expect, test } from "bun:test";

import { serverAudioBadge } from "@/domain/playback/track-capabilities";

test("serverAudioBadge maps language codes to flag + readable name", () => {
  expect(serverAudioBadge(["en"])).toBe("🇺🇸 English audio");
  expect(serverAudioBadge(["de"])).toBe("🇩🇪 German audio");
  expect(serverAudioBadge(["hi"])).toBe("🇮🇳 Hindi audio");
  expect(serverAudioBadge(["es-MX"])).toBe("🇪🇸 Spanish audio");
  expect(serverAudioBadge(["pt"])).toContain("Portuguese audio");
});

test("serverAudioBadge is graceful for empty and unknown languages", () => {
  expect(serverAudioBadge([])).toBeUndefined();
  expect(serverAudioBadge(undefined)).toBeUndefined();
  expect(serverAudioBadge(["zz"])).toContain("audio");
});
