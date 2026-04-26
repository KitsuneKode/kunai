#!/usr/bin/env bun

/**
 * Simple debug fetch – writes the raw embed page to raw_embed.html
 */
import { writeFile } from "fs/promises";
import process from "process";

const embedId = "127529"; // default used in earlier tests
const season = "1";
const episode = "2";

const embedUrl = `https://www.vidking.net/embed/tv/${embedId}/${season}/${episode}?autoPlay=true&episodeSelector=false&nextEpisode=false`;
const userAgent =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const referer = "https://www.vidking.net/";

(async () => {
  const resp = await fetch(embedUrl, {
    headers: { "User-Agent": userAgent, Referer: referer },
  });
  if (!resp.ok) {
    console.error(`❌ Failed fetch ${resp.status}`);
    process.exit(1);
  }
  const html = await resp.text();
  await writeFile("scratchpads/raw_embed.html", html);
  console.log(`✅ Saved raw embed HTML (${html.length} chars) to scratchpads/raw_embed.html`);
})();
