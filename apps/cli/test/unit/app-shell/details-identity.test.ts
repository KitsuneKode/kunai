import { expect, test } from "bun:test";

import { buildBrowseDetailsSheetSeed } from "@/app-shell/browse-shell-view";
import { buildDetailSubtitle } from "@/app-shell/details-view";

test("browse detail seeds carry video identity into the sheet", () => {
  const seed = buildBrowseDetailsSheetSeed({
    label: "Video",
    value: { id: "youtube:dQw4w9WgXcQ", type: "movie", externalIds: { youtubeId: "dQw4w9WgXcQ" } },
  });
  expect(seed.contentKind).toBe("video");
  expect(
    buildDetailSubtitle({
      id: "v",
      title: "Video",
      type: "movie",
      externalIds: { youtubeId: "dQw4w9WgXcQ" },
    }),
  ).toBe("Video");
});
