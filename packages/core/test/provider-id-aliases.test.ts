import { describe, expect, test } from "bun:test";

import { resolveProviderIdAlias, isVideasyFamilyProvider } from "@kunai/core";

describe("provider id aliases", () => {
  test("vidking folds to videasy", () => {
    expect(resolveProviderIdAlias("vidking")).toBe("videasy");
    expect(isVideasyFamilyProvider("vidking")).toBe(true);
  });
});
