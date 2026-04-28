import * as cheerio from "cheerio";
import { readFile } from "fs/promises";
import loader from "@assemblyscript/loader";
import CryptoJS from "crypto-js";
import { spawn } from "child_process";
import * as readline from "readline";

process.title = "hdtoday-scraper";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve));

// The 4 main servers used by Vidking (which HDToday uses under the hood)
const SERVERS = [
  { name: "Oxygen", endpoint: "mb-flix" },
  { name: "Hydrogen", endpoint: "cdn" },
  { name: "Lithium", endpoint: "downloader2" },
  { name: "Helium", endpoint: "1movies" },
];

async function main() {
  console.log("=========================================");
  console.log(" HDTODAY / CINEBY / VIDKING HEADLESS");
  console.log(" (0 RAM, Universal Backend Decryptor)");
  console.log("=========================================\n");

  const query =
    process.argv[2] || (await ask("Search for a movie/show (searches HDToday/Cineby backend): "));

  // 1. SEARCH HDTODAY
  console.log(`\n[*] Searching HDToday for: "${query}"...`);
  const searchRes = await fetch(`https://www.hdtoday.gd/search?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": userAgent },
  });
  const searchHtml = await searchRes.text();
  const $ = cheerio.load(searchHtml);

  const results: any[] = [];
  $(".film_list-wrap .flw-item").each((i, el) => {
    const aTag = $(el).find("a.film-poster-ahref");
    const title = aTag.attr("title");
    const href = aTag.attr("href");
    if (href && title) {
      const parts = href.split("/");
      results.push({ type: parts[1], id: parts[2], title });
    }
  });

  if (results.length === 0) {
    console.error("[!] No results found.");
    process.exit(1);
  }

  results.slice(0, 10).forEach((r, i) => console.log(`  [${i + 1}] ${r.title} (${r.type})`));
  const pickStr = await ask("\nPick item [1]: ");
  const pick = parseInt(pickStr || "1") - 1;
  const selected = results[pick];

  let season = "1";
  let episode = "1";

  if (selected.type === "series") {
    season = (await ask("Season [1]: ")) || "1";
    episode = (await ask("Episode [1]: ")) || "1";
  }

  const tmdbId = parseInt(selected.id);

  // 2. PICK PROVIDER
  console.log("\nAvailable Servers (Providers):");
  SERVERS.forEach((s, i) => console.log(`  [${i + 1}] ${s.name}`));
  const serverPickStr = await ask("\nPick server [1]: ");
  const serverPick = parseInt(serverPickStr || "1") - 1;
  const selectedServer = SERVERS[serverPick] || SERVERS[0];

  // 3. FETCH ENCRYPTED PAYLOAD FROM VIDKING API
  console.log(`\n[*] Fetching encrypted stream payload from ${selectedServer.name} API...`);
  const apiUrl = `https://api.videasy.net/${selectedServer.endpoint}/sources-with-title?title=${encodeURIComponent(selected.title)}&mediaType=${selected.type === "series" ? "tv" : "movie"}&year=2023&episodeId=${episode}&seasonId=${season}&tmdbId=${tmdbId}`;

  const payloadRes = await fetch(apiUrl, {
    headers: {
      "User-Agent": userAgent,
      Referer: "https://www.vidking.net/",
    },
  });

  if (!payloadRes.ok) {
    console.error(`[!] Failed to fetch from Videasy API. Status: ${payloadRes.status}`);
    process.exit(1);
  }

  const payload = (await payloadRes.text()).trim();
  console.log(`[+] Downloaded encrypted payload (${payload.length} bytes).`);

  // 4. DECRYPT USING PATCHED WASM
  console.log(`[*] Loading patched WASM decryptor...`);
  const wasmBuffer = await readFile(new URL("module1_patched.wasm", import.meta.url));
  const wasmModule = await loader.instantiate(wasmBuffer, {
    env: {
      seed: () => Date.now(),
      abort: () => console.error("WASM Aborted"),
    },
  });
  const n = wasmModule.exports as any;

  console.log(`[*] Running WASM Decryption pass...`);
  const payloadPtr = n.__newString(payload);
  const decryptedPtr = n.decrypt(payloadPtr, tmdbId);
  const wasmDecryptedBase64 = n.__getString(decryptedPtr);

  // 5. FINAL AES DECRYPTION
  console.log(`[*] Running Final AES Decryption (Bypassing Decoy Hashids/XOR logic)...`);
  const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedBase64, "");
  const finalJSONStr = decryptedBytes.toString(CryptoJS.enc.Utf8);

  if (!finalJSONStr) {
    console.error("[!] Failed to decrypt JSON.");
    process.exit(1);
  }

  const streamData = JSON.parse(finalJSONStr);

  if (!streamData.sources || streamData.sources.length === 0) {
    console.error("[!] No sources returned by the server.");
    process.exit(1);
  }

  // 6. EXTRACT QUALITIES
  console.log(`\n[+] Available Qualities:`);
  streamData.sources.forEach((s: any, i: number) => {
    console.log(`  [${i + 1}] ${s.quality}`);
  });

  const qualityPickStr = await ask(`\nPick quality [${streamData.sources.length}]: `);
  const qualityPick = parseInt(qualityPickStr || String(streamData.sources.length)) - 1;
  const bestSource =
    streamData.sources[qualityPick] || streamData.sources[streamData.sources.length - 1];

  const m3u8Url = bestSource.url;
  console.log(`\n[+] Selected Quality: ${bestSource.quality}`);
  console.log(`    -> ${m3u8Url}`);

  // 7. EXTRACT SUBTITLES (From the JSON directly, no extra API call needed!)
  let selectedSubUrl = null;
  if (streamData.subtitles && streamData.subtitles.length > 0) {
    const enSub = streamData.subtitles.find(
      (s: any) => s.lang === "eng" && !s.language.includes("SDH"),
    );
    if (enSub) {
      selectedSubUrl = enSub.url;
      console.log(`[+] Found English Subtitle: ${selectedSubUrl}`);
    } else {
      selectedSubUrl = streamData.subtitles[0].url;
      console.log(`[+] Found Subtitle (${streamData.subtitles[0].language}): ${selectedSubUrl}`);
    }
  } else {
    console.log(`[-] No subtitles included in the stream payload.`);
  }

  // 8. LAUNCH MPV
  console.log(`\n[*] Launching MPV Player...`);
  const mpvArgs = [m3u8Url, `--referrer=https://www.vidking.net/`, `--user-agent=${userAgent}`];
  if (selectedSubUrl) {
    mpvArgs.push(`--sub-file=${selectedSubUrl}`);
  }

  rl.close();

  if (!m3u8Url.includes('.m3u8') && !m3u8Url.includes('.mp4')) {
      console.log(`    [!] This is an embed link. 'mpv' will automatically use 'yt-dlp' to extract the raw video.`);
  }

  const mpv = spawn("mpv", mpvArgs, { stdio: "inherit" });
  mpv.on("close", () => {
    console.log("\n[+] Playback finished.");
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
