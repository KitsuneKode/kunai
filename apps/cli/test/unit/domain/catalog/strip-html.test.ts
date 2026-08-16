import { describe, expect, test } from "bun:test";

import { stripHtml } from "@/domain/catalog/strip-html";

describe("stripHtml", () => {
  test("removes italic and break tags instead of leaving their names", () => {
    expect(stripHtml("<i>Part 1 of the theatrical trilogy.</i><br><br>Tanjiro Kamado")).toBe(
      "Part 1 of the theatrical trilogy. Tanjiro Kamado",
    );
  });

  test("decodes common entities without preserving tag-shaped text", () => {
    expect(stripHtml("A &amp; B&nbsp;&lt;test&gt;")).toBe("A & B");
  });

  test("never recreates markup while decoding adversarial angle-bracket entities", () => {
    expect(stripHtml("safe &lt;img src=x onerror=alert(1)&gt; text")).toBe("safe text");
    expect(stripHtml("&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;")).toBe("alert(1)");
  });

  test("plain text is unchanged", () => {
    expect(stripHtml("No tags here")).toBe("No tags here");
  });
});
