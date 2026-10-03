import { expect, test } from "bun:test";

import { getAllmangaKnownCatalog } from "../src/catalogs/allmanga";
import { miruroInventorySourceId, getMiruroKnownCatalog } from "../src/catalogs/miruro";
import { mergeKnownCatalogSources } from "../src/shared/known-catalog";

test("miruroInventorySourceId keeps sub and dub as distinct source ids", () => {
  expect(miruroInventorySourceId("icarus", "sub")).toBe("source:miruro:catalog:icarus:sub");
  expect(miruroInventorySourceId("icarus", "dub")).toBe("source:miruro:catalog:icarus:dub");
  expect(miruroInventorySourceId("icarus", "sub")).not.toBe(
    miruroInventorySourceId("icarus", "dub"),
  );
});

test("getMiruroKnownCatalog labels catalog-era servers by their own names", () => {
  const catalog = getMiruroKnownCatalog(["sub", "dub"]);
  const icarusSub = catalog.find((entry) => entry.sourceId.endsWith(":icarus:sub"));
  const icarusDub = catalog.find((entry) => entry.sourceId.endsWith(":icarus:dub"));
  expect(icarusSub).toBeDefined();
  expect(icarusDub).toBeDefined();
  expect(icarusSub?.sourceId).not.toBe(icarusDub?.sourceId);
  // Catalog server names are already legible — the Gintama theme existed to
  // decode the pipe's opaque names, so these fall back to the technical label.
  expect(icarusSub?.label).toBe("Icarus");
  expect(icarusDub?.label).toBe("Icarus");
  expect(icarusSub?.subtitle).toBe("Sub · hard sub");
  expect(icarusDub?.subtitle).toBe("Dub · subtitles unknown");
  expect(icarusSub?.metadata?.flavorArchetype).toBe("Icarus · sub");
  expect(icarusDub?.metadata?.flavorArchetype).toBe("Icarus · dub");
  expect(icarusSub?.host).toBe("www.miruro.bz");
});

test("getMiruroKnownCatalog only exposes audio categories confirmed for the title", () => {
  const catalog = getMiruroKnownCatalog(["sub"]);

  expect(catalog.length).toBeGreaterThan(0);
  expect(catalog.every((entry) => entry.sourceId.endsWith(":sub"))).toBe(true);
  expect(catalog.some((entry) => entry.sourceId.endsWith(":dub"))).toBe(false);
});

test("allmanga keeps technical Sub/Dub · Server labels; miruro names its servers", () => {
  const allmangaSub = getAllmangaKnownCatalog("sub");
  const allmangaDub = getAllmangaKnownCatalog("dub");
  const defaultSub = allmangaSub.find((entry) => entry.sourceId.endsWith(":default"));
  const defaultDub = allmangaDub.find((entry) => entry.sourceId.endsWith(":default"));
  expect(defaultSub?.label).toBe("Sub · Default · hard sub");
  expect(defaultDub?.label).toBe("Dub · Default · subtitles unknown");
  expect(defaultSub?.subtitle).toBe("Bocchi · sub");
  expect(defaultDub?.subtitle).toBe("Nijika · dub");

  const miruro = getMiruroKnownCatalog(["sub"]);
  expect(miruro.every((entry) => !entry.label.startsWith("Sub · "))).toBe(true);
  expect(miruro.some((entry) => entry.label === "Animepahe")).toBe(true);
  expect(miruro.some((entry) => entry.label === "Icarus")).toBe(true);
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
