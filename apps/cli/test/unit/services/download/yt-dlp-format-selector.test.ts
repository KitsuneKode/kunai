import { expect, test } from "bun:test";

import { ytDlpFormatSelectorForQuality } from "@/services/download/DownloadService";

test("no quality / best / auto → undefined (keep yt-dlp default = highest)", () => {
  expect(ytDlpFormatSelectorForQuality(undefined)).toBeUndefined();
  expect(ytDlpFormatSelectorForQuality("best")).toBeUndefined();
  expect(ytDlpFormatSelectorForQuality("auto")).toBeUndefined();
  expect(ytDlpFormatSelectorForQuality("")).toBeUndefined();
});

test("a configured quality becomes a height ceiling with a safe fallback", () => {
  expect(ytDlpFormatSelectorForQuality("720p")).toBe(
    "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
  );
  expect(ytDlpFormatSelectorForQuality("1080p")).toBe(
    "best[height<=1080]/bestvideo[height<=1080]+bestaudio/best",
  );
  // Tolerant of surrounding text / spacing.
  expect(ytDlpFormatSelectorForQuality("HD 480 p")).toBe(
    "best[height<=480]/bestvideo[height<=480]+bestaudio/best",
  );
});
