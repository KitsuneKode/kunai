import { expect, test } from "bun:test";

import type { ProviderSourceCandidate } from "@kunai/types";

import { mergeKnownCatalogSources, type KnownCatalogEntry } from "../src/shared/known-catalog";

const cachePolicy = {
  ttlClass: "stream-manifest",
  scope: "local",
  keyParts: [],
} as const;

const catalog: readonly KnownCatalogEntry[] = [
  {
    sourceId: "source:videasy:flavor:alpha",
    label: "Alpha",
    audioLanguage: "en",
    moviesOnly: true,
  },
  {
    sourceId: "source:videasy:flavor:beta",
    label: "Beta",
    audioLanguage: "de",
  },
];

test("mergeKnownCatalogSources skips movies-only rows for series media", () => {
  const merged = mergeKnownCatalogSources({
    providerId: "videasy",
    mediaKind: "series",
    sources: [],
    catalog,
    cachePolicy,
  });
  expect(merged.map((source) => source.id)).toEqual(["source:videasy:flavor:beta"]);
});

test("mergeKnownCatalogSources preserves resolved sources and fills missing catalog rows", () => {
  const existing: ProviderSourceCandidate = {
    id: "source:videasy:flavor:beta",
    providerId: "videasy",
    kind: "provider-api",
    label: "Beta resolved",
    status: "selected",
    confidence: 0.95,
  };
  const merged = mergeKnownCatalogSources({
    providerId: "videasy",
    mediaKind: "movie",
    sources: [existing],
    catalog,
    cachePolicy,
  });
  expect(merged.find((source) => source.id === "source:videasy:flavor:beta")?.label).toBe(
    "Beta resolved",
  );
  expect(merged.find((source) => source.id === "source:videasy:flavor:alpha")).toMatchObject({
    label: "Alpha",
    status: "skipped",
    metadata: {
      pickerHint: "Fresh resolve required to try this source.",
    },
  });
  expect(merged.map((source) => source.id)).toEqual([
    "source:videasy:flavor:beta",
    "source:videasy:flavor:alpha",
  ]);
});
