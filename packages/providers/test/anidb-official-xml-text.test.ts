import { describe, expect, test } from "bun:test";

import { parseAnidbOfficialEpisodeMetadata } from "../src/anidb/client";

// Official AniDB summaries are markup that lands in terminal output: episode
// titles in the picker, synopses in the rail. The browse scraper already closed
// this class of hole; the XML parser reuses the same pipeline instead of its
// own tag strip, and these are the cases that separate the two.

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

const wrap = (title: string, summary = "") =>
  `<anime id="1"><episode id="1"><epno type="1">1</epno>` +
  `<title xml:lang="en">${title}</title><summary>${summary}</summary>` +
  `</episode></anime>`;

describe("anidb official xml text", () => {
  test("never decodes an entity into a live control character", () => {
    // A provider needs no raw ESC byte to smuggle one: `&#27;` is plain ASCII
    // in the response, and a decoder that mints it hands the terminal cursor
    // moves, screen clears, and OSC 52 clipboard writes.
    const parsed = parseAnidbOfficialEpisodeMetadata(wrap("Boom&#27;[2J&#7;"));
    const title = parsed.get(1)?.title ?? "";
    expect(title).not.toContain(ESC);
    expect(title).not.toContain(BEL);
    expect(title).toContain("&#27;");
  });

  test("strips a script span that survives a single tag pass", () => {
    const parsed = parseAnidbOfficialEpisodeMetadata(
      wrap("Ep", "<<script>script>alert(1)</script>tail"),
    );
    const synopsis = parsed.get(1)?.synopsis ?? "";
    expect(synopsis.toLowerCase()).not.toContain("<script");
    expect(synopsis).not.toContain("alert(1)");
  });

  test("decodes each entity exactly once", () => {
    const parsed = parseAnidbOfficialEpisodeMetadata(wrap("Tom &amp;amp; Jerry"));
    expect(parsed.get(1)?.title).toBe("Tom &amp; Jerry");
  });

  test("keeps only regular episodes, so specials never enter the playable sequence", () => {
    const parsed = parseAnidbOfficialEpisodeMetadata(
      `<anime id="1">
         <episode id="1"><epno type="1">1</epno><title xml:lang="en">Regular</title></episode>
         <episode id="2"><epno type="2">1</epno><title xml:lang="en">Special</title></episode>
       </anime>`,
    );
    expect([...parsed.values()].map((entry) => entry.title)).toEqual(["Regular"]);
  });
});
