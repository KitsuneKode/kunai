import { expect, test } from "bun:test";

import { launchNeedsYtDlp } from "@/app/bootstrap/launch-dependencies";

test("a YouTube share link needs yt-dlp like -y and a saved youtube mode", () => {
  expect(launchNeedsYtDlp({}, undefined, "video")).toBe(true);
  expect(launchNeedsYtDlp({ youtube: true }, undefined, undefined)).toBe(true);
  expect(launchNeedsYtDlp({}, "youtube", undefined)).toBe(true);
  expect(launchNeedsYtDlp({}, "series", "series")).toBe(false);
  expect(launchNeedsYtDlp({ offline: true }, "youtube", "video")).toBe(false);
});
