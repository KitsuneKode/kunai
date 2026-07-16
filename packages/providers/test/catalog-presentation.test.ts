import { expect, test } from "bun:test";

import { getVideasyKnownCatalog } from "../src/catalogs/videasy";
import { getVidlinkKnownCatalog } from "../src/catalogs/vidlink";

test("Videasy catalog uses consistent audio hints without operational notes", () => {
  const catalog = getVideasyKnownCatalog("movie");
  const yoru = catalog.find((entry) => entry.label === "Yoru");
  const killjoy = catalog.find((entry) => entry.label === "Killjoy");

  expect(yoru?.subtitle).toBe("Original audio");
  expect(killjoy?.subtitle).toBe("Original · German");
  expect(catalog.some((entry) => /4K|Kunai-only|Legacy|Alias/.test(entry.subtitle ?? ""))).toBe(
    false,
  );
});

test("VidLink catalog does not expose transport internals as user-facing copy", () => {
  const [entry] = getVidlinkKnownCatalog();

  expect(entry?.label).toBe("VidLink");
  expect(entry?.subtitle).toBeUndefined();
});
