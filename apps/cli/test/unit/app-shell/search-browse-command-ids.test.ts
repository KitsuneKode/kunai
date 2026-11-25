import { expect, test } from "bun:test";

import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";

test("browse palette exposes provider recovery commands", () => {
  expect(SEARCH_BROWSE_COMMAND_IDS).toContain("reset-provider-health");
  expect(SEARCH_BROWSE_COMMAND_IDS).toContain("clear-cache");
});

/** Neon features review #10: every way in has its way out from Browse. */
test("browse palette pairs follow with unfollow and mute, and offers share and /watch", () => {
  const offered: readonly string[] = SEARCH_BROWSE_COMMAND_IDS;
  for (const id of ["unfollow", "mute", "share", "share-qr", "watch", "sync", "playlist-add"]) {
    expect(offered).toContain(id);
  }
});
