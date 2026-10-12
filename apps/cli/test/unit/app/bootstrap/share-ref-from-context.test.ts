import { expect, test } from "bun:test";

import {
  buildShareRefFromTitleContext,
  describeKunaiHandoffLaunch,
} from "@/app/bootstrap/share-ref-from-context";

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

test("describeKunaiHandoffLaunch strips terminal escapes from search queries", () => {
  // The query arrives in a kunai:// URL and is shown pre-confirm, so an OSC
  // hyperlink smuggled into it must not reach the terminal.
  const description = describeKunaiHandoffLaunch({
    action: "play",
    ref: {
      anchor: { by: "search", query: "Dune\x1b]8;;https://evil.example\x07: Part Two" },
      kind: "movie",
    },
    requiresConfirmation: true,
  });
  expect(description).toBe('Open playback for search "Dune: Part Two" in default mode');
  expect(description).not.toContain("\x1b");
});
