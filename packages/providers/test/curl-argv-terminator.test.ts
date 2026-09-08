import { expect, test } from "bun:test";

/**
 * Both curl call sites put the fetch URL last in argv, and those URLs come from
 * upstream JSON (AniDB `embed_url`, the Miruro pipe payload). Without a `--`
 * terminator curl reads a value beginning with `-` as options rather than as
 * the address, so upstream JSON gets a say in the argv of a local subprocess.
 *
 * Guarded at the source because the argv is assembled inside the fetch
 * helpers, with no seam to observe it from a behavioural test.
 */
const CURL_ARGV_SITES = [
  { file: "src/anidb/client.ts", url: "url" },
  { file: "src/miruro/direct.ts", url: "url" },
] as const;

for (const site of CURL_ARGV_SITES) {
  test(`${site.file} terminates curl options before the URL operand`, async () => {
    const source = await Bun.file(new URL(`../${site.file}`, import.meta.url)).text();

    // The argv array literal ends with the terminator immediately before the
    // URL. Comments and whitespace between them are fine; another argument is
    // not, because it would land after `--` and be read as a second operand.
    const terminated = new RegExp(String.raw`"--",\s*(?://[^\n]*\n\s*)*${site.url},\s*\]`);

    expect(source).toMatch(terminated);
  });
}
