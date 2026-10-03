import { expect, test } from "bun:test";

/**
 * Every curl call site puts the fetch URL last in argv, and those URLs come
 * from upstream JSON (AniDB `embed_url`, provider stream rows). Without a `--`
 * terminator curl reads a value beginning with `-` as options rather than as
 * the address, so upstream JSON gets a say in the argv of a local subprocess.
 *
 * Guarded at the source because the argv is assembled inside the fetch
 * helpers, with no seam to observe it from a behavioural test.
 */
const CURL_ARGV_SITES = [
  // The shared transport assembles the argv for every provider that delegates
  // to it (hianime, animekai, anidb, animegg).
  { file: "src/shared/provider-http-transport.ts", url: "curlTarget" },
  // The reachability probe's player-shaped retry assembles its own argv.
  { file: "src/shared/stream-reachability.ts", url: "url" },
] as const;

for (const site of CURL_ARGV_SITES) {
  test(`${site.file} terminates curl options before the URL operand`, async () => {
    const source = await Bun.file(new URL(`../${site.file}`, import.meta.url)).text();

    // The argv ends with the terminator immediately before the URL, whether
    // the site pushes it (`args.push(...)`) or closes an array literal.
    // Comments and whitespace between them are fine; another argument is
    // not, because it would land after `--` and be read as a second operand.
    const terminated = new RegExp(String.raw`"--",\s*(?://[^\n]*\n\s*)*${site.url},?\s*[)\]]`);

    expect(source).toMatch(terminated);
  });
}
