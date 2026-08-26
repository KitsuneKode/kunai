import { describe, expect, test } from "bun:test";

import { extractArray, extractString } from "../lib/manifest-parsing";

/** `parseManifest` normalizes newlines before extracting, so tests do the same. */
const normalize = (source: string): string => source.replace(/\n\s*/g, " ");

describe("provider manifest array extraction", () => {
  test("keeps a comma inside a note as one entry", () => {
    expect(extractArray(normalize(`notes: ["one note, with a comma", "second"]`), "notes")).toEqual(
      ["one note, with a comma", "second"],
    );
  });

  test("keeps an apostrophe inside a note", () => {
    expect(
      extractArray(normalize(`notes: ["Frieren: Beyond Journey's End is supported"]`), "notes"),
    ).toEqual(["Frieren: Beyond Journey's End is supported"]);
  });

  test("keeps a bracket inside a note and does not drop later entries", () => {
    expect(
      extractArray(normalize(`notes: ["routes map to /cdn [legacy]", "second note"]`), "notes"),
    ).toEqual(["routes map to /cdn [legacy]", "second note"]);
  });

  test("reads single quoted, double quoted, and backtick entries alike", () => {
    expect(
      extractArray(
        normalize("capabilities: ['source-resolve', \"multi-source\", `quality-ranked`]"),
        "capabilities",
      ),
    ).toEqual(["source-resolve", "multi-source", "quality-ranked"]);
  });

  test("unescapes an escaped quote rather than dropping it", () => {
    expect(extractArray(normalize(`notes: ["a \\"quoted\\" word"]`), "notes")).toEqual([
      'a "quoted" word',
    ]);
  });

  test("tolerates a trailing comma and surrounding whitespace", () => {
    expect(extractArray(normalize(`notes: [ "first", "second", ]`), "notes")).toEqual([
      "first",
      "second",
    ]);
  });

  test("returns nothing for an empty array or a missing property", () => {
    expect(extractArray(normalize(`notes: []`), "notes")).toEqual([]);
    expect(extractArray(normalize(`status: "active"`), "notes")).toEqual([]);
  });

  test("reads the named property, not a different array nearby", () => {
    const source = normalize(`mediaKinds: ["movie", "series"], capabilities: ["source-resolve"]`);
    expect(extractArray(source, "mediaKinds")).toEqual(["movie", "series"]);
    expect(extractArray(source, "capabilities")).toEqual(["source-resolve"]);
  });
});

describe("provider manifest string extraction", () => {
  test("keeps an apostrophe instead of truncating at it", () => {
    expect(extractString(normalize(`description: "ani-cli's parity source"`), "description")).toBe(
      "ani-cli's parity source",
    );
  });

  test("reads single quoted and backtick values", () => {
    expect(extractString(normalize(`domain: 'videasy.to'`), "domain")).toBe("videasy.to");
    expect(extractString(normalize("status: `active`"), "status")).toBe("active");
  });

  test("unescapes an escaped quote", () => {
    expect(extractString(normalize(`displayName: "the \\"good\\" one"`), "displayName")).toBe(
      'the "good" one',
    );
  });

  test("returns null when the property is absent", () => {
    expect(extractString(normalize(`status: "active"`), "domain")).toBeNull();
  });
});
