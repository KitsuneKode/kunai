#!/usr/bin/env bun

/**
 * vidking-cli-ts.ts – Head‑less Vidking extractor (TypeScript version)
 * ---------------------------------------------------------------
 * This script replicates the core logic of the bash version derived from
 * `ani-cli` but is written in TypeScript so it can be run directly with
 * Bun (or Node with the appropriate flags).
 *
 * Usage (from repository root):
 *   bun vidking-cli-ts.ts                # uses default embed ID/season/episode
 *   bun vidking-cli-ts.ts 127529 1 2     # specify embedId season episode
 *   PLAY=1 bun vidking-cli-ts.ts         # also launch mpv automatically
 *
 * The script:
 *   1. Fetches the embed page using `fetch` (no Playwright).
 *   2. Extracts the master HLS playlist URL and subtitle URL from the
 *      embedded JSON (regex based – mirrors `ani-cli`'s get_links).
 *   3. Writes a JSON summary (`vidking-summary.json`).
 *   4. Optionally spawns `mpv` with the correct headers and subtitle.
 */

import { writeFile } from "fs/promises";
import { spawn } from "child_process";
import process from "process";

(async () => {
  // -------------------------------------------------------------------
  // 1️⃣  Parse CLI arguments (embedId, season, episode)
  // -------------------------------------------------------------------
  const [, , embedIdArg, seasonArg, episodeArg] = process.argv;
  const embedId = embedIdArg ?? "127529"; // default used in earlier examples
  const season = seasonArg ?? "1";
  const episode = episodeArg ?? "2";

  const embedUrl = `https://www.vidking.net/embed/tv/${embedId}/${season}/${episode}`;
  const userAgent =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
  const referer = "https://www.vidking.net/";

  // -------------------------------------------------------------------
  // 2️⃣  Fetch the raw embed HTML (no browser required)
  // -------------------------------------------------------------------
  const resp = await fetch(embedUrl, {
    headers: {
      "User-Agent": userAgent,
      Referer: referer,
    },
  });
  if (!resp.ok) {
    console.error(`❌ Failed to fetch embed page – status ${resp.status}`);
    process.exit(1);
  }
  const html = await resp.text();

  // -------------------------------------------------------------------
  // 3️⃣  Extract the HLS master playlist URL
  // -------------------------------------------------------------------
  // The embed page contains a fragment like "hls","url":"https://…/master.m3u8"
  const streamMatch = html.match(/"hls","url":"([^\"]+)"/);
  const streamUrl = streamMatch?.[1] ?? null;
  if (!streamUrl) {
    console.error("❌ Could not locate master .m3u8 URL in embed page");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // 4️⃣  Extract subtitle URL (if any)
  // -------------------------------------------------------------------
  // Vidking embeds subtitles in a JSON array: "subtitles":[{"src":"https://…/en.vtt"}]
  const subtitleMatch = html.match(/"subtitles"\s*:\s*\[\{[^}]*"src"\s*:\s*"([^\"]+)"/);
  const subtitleUrl = subtitleMatch?.[1] ?? null; // may be null – subtitles are optional

  // -------------------------------------------------------------------
  // 5️⃣  Write a concise JSON summary for downstream consumption
  // -------------------------------------------------------------------
  const summary = {
    stream: streamUrl,
    ...(subtitleUrl && { subtitle: subtitleUrl }),
    headers: {
      "user-agent": userAgent,
      referer,
    },
  } as const;

  const summaryPath = "vidking-summary.json";
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`✅ Summary written to ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));

  // -------------------------------------------------------------------
  // 6️⃣  Optional: launch mpv directly (set PLAY=1 in env)
  // -------------------------------------------------------------------
  if (process.env.PLAY === "1") {
    const mpvArgs = [streamUrl];
    if (subtitleUrl) mpvArgs.push(`--sub-file=${subtitleUrl}`);
    mpvArgs.push(`--user-agent=${userAgent}`, `--referrer=${referer}`);
    console.log("🚀 Launching mpv…");
    const mpv = spawn("mpv", mpvArgs, { stdio: "inherit" });
    mpv.on("close", (code) => process.exit(code ?? 0));
  }
})();
