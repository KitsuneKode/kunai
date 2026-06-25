import { expect, test } from "bun:test";

import { buildShareRefFromTitleContext } from "@/app/bootstrap/share-ref-from-context";

test("buildShareRefFromTitleContext encodes youtube catalog anchors", () => {
  const ref = buildShareRefFromTitleContext({
    title: {
      id: "youtube:dQw4w9WgXcQ",
      type: "movie",
      name: "Never Gonna Give You Up",
      externalIds: { youtubeId: "dQw4w9WgXcQ" },
    },
    mode: "youtube",
    startSeconds: 30,
    providerId: "youtube",
  });

  expect(ref).toEqual({
    anchor: { by: "catalog", ns: "youtube", id: "dQw4w9WgXcQ" },
    kind: "video",
    startSeconds: 30,
    title: "Never Gonna Give You Up",
    hint: { providerId: "youtube" },
  });
});
