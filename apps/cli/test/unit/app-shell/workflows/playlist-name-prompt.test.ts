import { expect, test } from "bun:test";

import { defaultPlaylistNameSuggestion } from "@/app-shell/workflows/playlist-name-prompt";

test("defaultPlaylistNameSuggestion uses an ISO date suffix", () => {
  expect(defaultPlaylistNameSuggestion()).toMatch(/^Playlist \d{4}-\d{2}-\d{2}$/);
});
