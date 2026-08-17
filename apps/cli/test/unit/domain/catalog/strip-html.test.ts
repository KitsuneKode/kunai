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
  });

  test("a tag split across another tag is still removed", () => {
    // One strip pass turns this into `<script>`; the fixed-point loop is what
    // stops the output being markup.
    expect(stripHtml("<scr<foo>ipt>alert(1)</scr<foo>ipt>")).toBe("alert(1)");
  });

  test("double-encoded text keeps the escaping its author chose", () => {
    // `&amp;lt;` is the encoding of the literal characters `&lt;`, so the
    // source says "&lt;", not "<". Decoding twice would turn prose about HTML
    // into HTML and then delete it — the text is lost either way.
    expect(stripHtml("&amp;lt;script&amp;gt; is how you escape a tag")).toBe(
      "&lt;script&gt; is how you escape a tag",
    );
    expect(stripHtml("Rock &amp;amp; Roll")).toBe("Rock &amp; Roll");
  });

  test("an unterminated tag does not swallow the rest of the text", () => {
    expect(stripHtml("before <b>bold</b> after")).toBe("before bold after");
    expect(stripHtml("a <not closed")).toBe("a <not closed");
  });

  test("entity case and numeric apostrophes are handled", () => {
    expect(stripHtml("Tom&#39;s &AMP; Jerry&apos;s")).toBe("Tom's & Jerry's");
  });

  test("collapses the whitespace that stripping leaves behind", () => {
    expect(stripHtml("a <b></b> <i></i>  b")).toBe("a b");
  });

  test("plain text is unchanged", () => {
    expect(stripHtml("No tags here")).toBe("No tags here");
  });

  test("empty and whitespace-only input", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml("   \n\t ")).toBe("");
  });

  test("no adversarial input produces a complete tag in the output", () => {
    // The invariant, stated once, so a future rewrite is judged on the
    // property rather than on the cases someone happened to think of.
    const attacks = [
      "<script>alert(1)</script>",
      "<scr<foo>ipt>alert(1)</scr<foo>ipt>",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
      "&LT;IMG SRC=x ONERROR=alert(1)&GT;",
      "&#39;&lt;svg onload=alert(1)&gt;",
      "<<b>script>alert(1)<</b>/script>",
      "&lt;&lt;b&gt;script&gt;",
      "<img src=x onerror=alert(1)>",
      "&nbsp;&lt;iframe src=javascript:alert(1)&gt;&nbsp;",
      "<div<div>>text",
    ];

    for (const attack of attacks) {
      expect(stripHtml(attack)).not.toMatch(/<[^<>]*>/);
    }
  });
});
