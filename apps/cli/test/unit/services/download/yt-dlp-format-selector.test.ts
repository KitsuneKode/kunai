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
    "bv*[height<=?720]+ba/bv*[height<=?720]/bv*+ba/b",
  );
  expect(ytDlpFormatSelectorForQuality("1080p")).toBe(
    "bv*[height<=?1080]+ba/bv*[height<=?1080]/bv*+ba/b",
  );
  expect(ytDlpFormatSelectorForQuality("HD 480 p")).toBe(
    "bv*[height<=?480]+ba/bv*[height<=?480]/bv*+ba/b",
  );
});
