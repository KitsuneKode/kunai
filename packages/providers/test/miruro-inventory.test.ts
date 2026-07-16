import { expect, test } from "bun:test";

import { getAllmangaKnownCatalog } from "../src/catalogs/allmanga";
import { miruroInventorySourceId, getMiruroKnownCatalog } from "../src/catalogs/miruro";
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
  expect(kiwiSub?.label).toBe("Sub · Kiwi · hard sub");
  expect(kiwiDub?.label).toBe("Dub · Kiwi · subtitles unknown");
  expect(kiwiSub?.subtitle).toBe("Gintoki · sub");
  expect(kiwiDub?.subtitle).toBe("Kagura · dub");
  expect(kiwiSub?.host).toBe("www.miruro.bz");
});

test("getMiruroKnownCatalog only exposes audio categories confirmed for the title", () => {
  const catalog = getMiruroKnownCatalog(["sub"]);

  expect(catalog.length).toBeGreaterThan(0);
  expect(catalog.every((entry) => entry.sourceId.endsWith(":sub"))).toBe(true);
  expect(catalog.some((entry) => entry.sourceId.endsWith(":dub"))).toBe(false);
});

test("allmanga and miruro catalogs share Sub/Dub · Server · mode labels", () => {
  const allmangaSub = getAllmangaKnownCatalog("sub");
  const allmangaDub = getAllmangaKnownCatalog("dub");
  const defaultSub = allmangaSub.find((entry) => entry.sourceId.endsWith(":default"));
  const defaultDub = allmangaDub.find((entry) => entry.sourceId.endsWith(":default"));
  expect(defaultSub?.label).toBe("Sub · Default · hard sub");
  expect(defaultDub?.label).toBe("Dub · Default · subtitles unknown");
  expect(defaultSub?.subtitle).toBe("Bocchi · sub");
  expect(defaultDub?.subtitle).toBe("Nijika · dub");

  const miruro = getMiruroKnownCatalog(["sub"]);
  expect(miruro.every((entry) => entry.label.startsWith("Sub · "))).toBe(true);
  expect(allmangaSub.every((entry) => entry.label.startsWith("Sub · "))).toBe(true);
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
