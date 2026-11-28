/**
 * Notify Bing / DuckDuckGo / Yandex / ChatGPT Search via IndexNow after a docs deploy.
 *
 * Setup:
 *   1. Generate a 32-char hex key and commit `apps/docs/public/<key>.txt` containing only `<key>`.
 *   2. Run `INDEXNOW_KEY=<key> bun run apps/docs/scripts/ping-indexnow.ts` after production deploy.
 */
import { docsSiteUrl } from "../lib/site";

async function main(): Promise<void> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    console.error("INDEXNOW_KEY is required (must match apps/docs/public/<key>.txt).");
    process.exit(1);
  }

  const sitemapUrl = `${docsSiteUrl}/sitemap.xml`;
  const sitemapRes = await fetch(sitemapUrl);
  if (!sitemapRes.ok) {
    console.error(`Failed to fetch ${sitemapUrl}: HTTP ${sitemapRes.status}`);
    process.exit(1);
  }
  const xml = await sitemapRes.text();
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((url) => url.startsWith(docsSiteUrl));

  if (urlList.length === 0) {
    console.error(`No URLs found in ${sitemapUrl}`);
    process.exit(1);
  }

  const host = new URL(docsSiteUrl).host;
  const keyLocation = `${docsSiteUrl}/${key}.txt`;
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`IndexNow rejected submission: HTTP ${res.status} ${body.slice(0, 200)}`);
    process.exit(1);
  }

  console.log(`IndexNow accepted ${urlList.length} URLs for ${host} (HTTP ${res.status}).`);
}

await main();
