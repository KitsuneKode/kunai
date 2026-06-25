import { expect, test } from "bun:test";

import { ytDlpFormatSelectorForQuality } from "@/services/download/DownloadService";

test("no quality / best / auto → undefined (keep yt-dlp default = highest)", () => {
  expect(ytDlpFormatSelectorForQuality(undefined)).toBeUndefined();
  expect(ytDlpFormatSelectorForQuality("best")).toBeUndefined();
  expect(ytDlpFormatSelectorForQuality("auto")).toBeUndefined();
  expect(ytDlpFormatSelectorForQuality("")).toBeUndefined();
});

test("a configured quality becomes a height ceiling with DASH merge first", () => {
  expect(ytDlpFormatSelectorForQuality("720p")).toBe(
    "bestvideo[height<=720]+bestaudio/bestvideo[height<=720]/bestvideo+bestaudio/bv*+ba/b",
  );
  expect(ytDlpFormatSelectorForQuality("1080p")).toBe(
    "bestvideo[height<=1080]+bestaudio/bestvideo[height<=1080]/bestvideo+bestaudio/bv*+ba/b",
  );
  expect(ytDlpFormatSelectorForQuality("HD 480 p")).toBe(
    "bestvideo[height<=480]+bestaudio/bestvideo[height<=480]/bestvideo+bestaudio/bv*+ba/b",
  );
});
