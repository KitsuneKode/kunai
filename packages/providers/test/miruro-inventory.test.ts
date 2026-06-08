import { expect, test } from "bun:test";

import { miruroInventorySourceId } from "../src/catalogs/miruro";
import { getMiruroKnownCatalog } from "../src/catalogs/miruro";
import { mergeKnownCatalogSources } from "../src/shared/known-catalog";

test("miruroInventorySourceId keeps sub and dub as distinct source ids", () => {
  expect(miruroInventorySourceId("kiwi", "sub")).toBe("source:miruro:pipe:kiwi:sub");
  expect(miruroInventorySourceId("kiwi", "dub")).toBe("source:miruro:pipe:kiwi:dub");
  expect(miruroInventorySourceId("kiwi", "sub")).not.toBe(miruroInventorySourceId("kiwi", "dub"));
});

test("getMiruroKnownCatalog exposes separate sub and dub rows per server", () => {
  const catalog = getMiruroKnownCatalog(["sub", "dub"]);
  const kiwiSub = catalog.find((entry) => entry.sourceId.endsWith(":kiwi:sub"));
  const kiwiDub = catalog.find((entry) => entry.sourceId.endsWith(":kiwi:dub"));
  expect(kiwiSub).toBeDefined();
  expect(kiwiDub).toBeDefined();
  expect(kiwiSub?.sourceId).not.toBe(kiwiDub?.sourceId);
});

test("mergeKnownCatalogSources does not collapse miruro sub and dub inventory rows", () => {
  const merged = mergeKnownCatalogSources({
    providerId: "miruro",
    mediaKind: "anime",
    sources: [],
    catalog: getMiruroKnownCatalog(["sub", "dub"]).slice(0, 4),
    cachePolicy: {
      ttlClass: "stream-manifest",
      scope: "local",
      keyParts: [],
    },
  });
  const ids = merged.map((source) => source.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.some((id) => id.endsWith(":sub"))).toBe(true);
  expect(ids.some((id) => id.endsWith(":dub"))).toBe(true);
});
