import { expect, test } from "bun:test";

import { parseKunaiHandoffUrl } from "@/app/handoff-url";

test("parseKunaiHandoffUrl accepts search playback handoffs with local confirmation required", () => {
  expect(parseKunaiHandoffUrl("kunai://play?search=Dune&mode=anime")).toEqual({
    action: "play",
    search: "Dune",
    anime: true,
    requiresConfirmation: true,
  });
});

test("parseKunaiHandoffUrl accepts direct title and download handoffs", () => {
  expect(parseKunaiHandoffUrl("kunai://download?id=438631&type=movie")).toEqual({
    action: "download",
    id: "438631",
    type: "movie",
    requiresConfirmation: true,
  });
});

test("parseKunaiHandoffUrl rejects unsafe schemes and incomplete direct ids", () => {
  expect(parseKunaiHandoffUrl("https://example.com/play?search=Dune")).toBeNull();
  expect(parseKunaiHandoffUrl("javascript:alert(1)")).toBeNull();
  expect(parseKunaiHandoffUrl("kunai://play?id=438631&type=anime")).toBeNull();
});
