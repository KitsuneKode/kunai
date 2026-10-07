import { expect, test } from "bun:test";

/**
 * Every curl call site puts the fetch URL last in argv behind a `--`
 * terminator, and those URLs come from upstream JSON (AniDB `embed_url`, the
 * Miruro pipe payload, HiAnime server markup). Without the terminator curl
 * reads a value beginning with `-` as options rather than as the address, so
 * upstream JSON gets a say in the argv of a local subprocess.
 *
 * Guarded at the source because the argv is assembled inside the fetch
 * helpers, with no seam to observe it from a behavioural test.
 */
const CURL_ARGV_SITES = [
  // anidb builds two argv arrays: the `-sL` page fetch and the manual-redirect
  // `-s` hop fetch.
  { file: "src/anidb/client.ts", url: "url", occurrences: 2 },
  { file: "src/hianime/client.ts", url: "url", occurrences: 1 },
  { file: "src/miruro/direct.ts", url: "url", occurrences: 1 },
] as const;

for (const site of CURL_ARGV_SITES) {
  test(`${site.file} terminates curl options before the URL operand`, async () => {
    const source = await Bun.file(new URL(`../${site.file}`, import.meta.url)).text();

    // The argv array literal ends with the terminator immediately before the
    // URL. Comments and whitespace between them are fine; another argument is
    // not, because it would land after `--` and be read as a second operand.
    const terminated = new RegExp(String.raw`"--",\s*(?://[^\n]*\n\s*)*${site.url},\s*\]`, "g");

    expect(source.match(terminated)?.length ?? 0).toBe(site.occurrences);
  });
}
