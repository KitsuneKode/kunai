import { expect, test } from "bun:test";

import { SEARCH_BROWSE_COMMAND_IDS } from "@/app-shell/search-browse-command-ids";

test("browse palette exposes provider recovery commands", () => {
  expect(SEARCH_BROWSE_COMMAND_IDS).toContain("reset-provider-health");
  expect(SEARCH_BROWSE_COMMAND_IDS).toContain("clear-cache");
});
