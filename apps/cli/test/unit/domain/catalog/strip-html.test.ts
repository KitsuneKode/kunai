import { describe, expect, test } from "bun:test";

import { stripHtml } from "@/domain/catalog/strip-html";

describe("stripHtml", () => {
  test("removes italic and break tags instead of leaving their names", () => {
    expect(stripHtml("<i>Part 1 of the theatrical trilogy.</i><br><br>Tanjiro Kamado")).toBe(
      "Part 1 of the theatrical trilogy. Tanjiro Kamado",
    );
  });

  test("decodes common entities and collapses whitespace", () => {
    expect(stripHtml("A &amp; B&nbsp;&lt;test&gt;")).toBe("A & B <test>");
  });

  test("plain text is unchanged", () => {
    expect(stripHtml("No tags here")).toBe("No tags here");
  });
});
