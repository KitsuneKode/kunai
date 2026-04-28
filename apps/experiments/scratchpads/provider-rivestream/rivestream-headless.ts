import * as readline from "readline";
import { spawn } from "child_process";

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.rivestream.app",
  Referer: "https://www.rivestream.app/",
};

const fetchOptions = { headers, signal: AbortSignal.timeout(45000) };

function ask(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

const cArray = [
  "4Z7lUo",
  "gwIVSMD",
  "PLmz2elE2v",
  "Z4OFV0",
  "SZ6RZq6Zc",
  "zhJEFYxrz8",
  "FOm7b0",
  "axHS3q4KDq",
  "o9zuXQ",
  "4Aebt",
  "wgjjWwKKx",
  "rY4VIxqSN",
  "kfjbnSo",
  "2DyrFA1M",
  "YUixDM9B",
  "JQvgEj0",
  "mcuFx6JIek",
  "eoTKe26gL",
  "qaI9EVO1rB",
  "0xl33btZL",
  "1fszuAU",
  "a7jnHzst6P",
  "wQuJkX",
  "cBNhTJlEOf",
  "KNcFWhDvgT",
  "XipDGjST",
  "PCZJlbHoyt",
  "2AYnMZkqd",
  "HIpJh",
  "KH0C3iztrG",
  "W81hjts92",
  "rJhAT",
  "NON7LKoMQ",
  "NMdY3nsKzI",
  "t4En5v",
  "Qq5cOQ9H",
  "Y9nwrp",
  "VX5FYVfsf",
  "cE5SJG",
  "x1vj1",
  "HegbLe",
  "zJ3nmt4OA",
  "gt7rxW57dq",
  "clIE9b",
  "jyJ9g",
  "B5jXjMCSx",
  "cOzZBZTV",
  "FTXGy",
  "Dfh1q1",
  "ny9jqZ2POI",
  "X2NnMn",
  "MBtoyD",
  "qz4Ilys7wB",
  "68lbOMye",
  "3YUJnmxp",
  "1fv5Imona",
  "PlfvvXD7mA",
  "ZarKfHCaPR",
  "owORnX",
  "dQP1YU",
  "dVdkx",
  "qgiK0E",
  "cx9wQ",
  "5F9bGa",
  "7UjkKrp",
  "Yvhrj",
  "wYXez5Dg3",
  "pG4GMU",
  "MwMAu",
  "rFRD5wlM",
];

function generateSecretKey(e: string | number) {
  if (e === undefined) return "rive";
  try {
    let t, n;
    let r = String(e);
    if (isNaN(Number(e))) {
      let sum = r.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      t = cArray[sum % cArray.length] || btoa(r);
      n = Math.floor((sum % r.length) / 2);
    } else {
      let i = Number(e);
      t = cArray[i % cArray.length] || btoa(r);
      n = Math.floor((i % r.length) / 2);
    }

    let i = r.slice(0, n) + t + r.slice(n);

    const hash2 = (e: string) => {
      let t = 0;
      for (let n = 0; n < e.length; n++) {
        let r = e.charCodeAt(n);
        let i =
          (((t = (r + (t << 6) + (t << 16) - t) >>> 0) << (n % 5)) | (t >>> (32 - (n % 5)))) >>> 0;
        t ^= (i ^ ((r << (n % 7)) | (r >>> (8 - (n % 7))))) >>> 0;
        t = (t + ((t >>> 11) ^ (t << 3))) >>> 0;
      }
      t ^= t >>> 15;
      t = ((65535 & t) * 49842 + ((((t >>> 16) * 49842) & 65535) << 16)) >>> 0;
      t ^= t >>> 13;
      t = ((65535 & t) * 40503 + ((((t >>> 16) * 40503) & 65535) << 16)) >>> 0;
      return (t ^= t >>> 16).toString(16).padStart(8, "0");
    };

    const o = (e: string) => {
      let t = String(e);
      let n = 3735928559 ^ t.length;
      for (let e = 0; e < t.length; e++) {
        let r = t.charCodeAt(e);
        r ^= ((131 * e + 89) ^ (r << (e % 5))) & 255;
        n = (((n << 7) | (n >>> 25)) >>> 0) ^ r;
        let i = (65535 & n) * 60205;
        let o = ((n >>> 16) * 60205) << 16;
        n = (i + o) >>> 0;
        n ^= n >>> 11;
      }
      n ^= n >>> 15;
      n = ((65535 & n) * 49842 + (((n >>> 16) * 49842) << 16)) >>> 0;
      n ^= n >>> 13;
      n = ((65535 & n) * 40503 + (((n >>> 16) * 40503) << 16)) >>> 0;
      n ^= n >>> 16;
      n = ((65535 & n) * 10196 + (((n >>> 16) * 10196) << 16)) >>> 0;
      return (n ^= n >>> 15).toString(16).padStart(8, "0");
    };

    return btoa(o(hash2(i)));
  } catch (err) {
    return "topSecret";
  }
}

async function main() {
  process.title = "rivestream-scraper";
  console.log("=========================================");
  console.log(" RIVESTREAM HEADLESS SCRAPER");
  console.log(" (0 RAM, Full Flow w/ Search & Qualities)");
  console.log("=========================================\n");

  const query = process.argv[2] || (await ask("Enter movie/show to search: "));
  if (!query) {
    console.error("[!] No query provided.");
    process.exit(1);
  }

  console.log(`\n[*] Searching Rivestream for "${query}"...`);
  const searchKey = generateSecretKey(query);
  const searchUrl = `https://www.rivestream.app/api/backendfetch?requestID=searchMulti&query=${encodeURIComponent(query)}&secretKey=${searchKey}&proxyMode=undefined`;

  try {
    const searchRes = await fetch(searchUrl, fetchOptions);
    if (!searchRes.ok) {
      console.error(`\n[!] Search API failed: ${searchRes.status} ${searchRes.statusText}`);
      process.exit(1);
    }

    const searchData = await searchRes.json();
    const results = searchData.results || [];

    if (results.length === 0) {
      console.log("[-] No results found.");
      process.exit(0);
    }

    console.log("\nSearch Results:");
    results.slice(0, 10).forEach((r: any, i: number) => {
      const title = r.name || r.title || r.original_title;
      const year = r.release_date
        ? r.release_date.split("-")[0]
        : r.first_air_date
          ? r.first_air_date.split("-")[0]
          : "Unknown";
      console.log(`  [${i + 1}] ${title} (${year}) - [${r.media_type.toUpperCase()}]`);
    });

    const pickStr = await ask("\nPick item [1]: ");
    const pick = parseInt(pickStr || "1") - 1;
    const selected = results[pick] || results[0];

    const isTv = selected.media_type === "tv";
    const type = isTv ? "tv" : "movie";
    const tmdbId = selected.id;

    let season = "1",
      episode = "1";
    if (isTv) {
      season = (await ask("Season [1]: ")) || "1";
      episode = (await ask("Episode [1]: ")) || "1";
    }

    const modeStr = await ask("\nEnter mode (1: Video, 2: Embed, 3: Torrent) [1]: ");
    let modePrefix = "Video";
    if (modeStr.trim() === "2") modePrefix = "Embed";
    if (modeStr.trim() === "3") modePrefix = "Torrent";

    const provRes = await fetch(
      `https://www.rivestream.app/api/backendfetch?requestID=${modePrefix}ProviderServices&secretKey=rive&proxyMode=undefined`,
      fetchOptions,
    );
    const provData = await provRes.json();
    const providers = provData.data || [];

    if (providers.length === 0) {
      console.error("[!] No providers found.");
      process.exit(1);
    }

    console.log("\nAvailable Providers:");
    providers.forEach((p: string, i: number) => console.log(`  [${i + 1}] ${p}`));
    const provPickStr = await ask(`\nPick provider [1]: `);
    const provPick = parseInt(provPickStr || "1") - 1;
    const selectedProvider = providers[provPick] || providers[0];

    const secretKey = generateSecretKey(tmdbId);
    let url = `https://www.rivestream.app/api/backendfetch?requestID=${type}${modePrefix}Provider&id=${tmdbId}&service=${selectedProvider}&secretKey=${secretKey}&proxyMode=noProxy`;
    if (isTv) url += `&season=${season}&episode=${episode}`;

    console.log(`[*] Fetching sources...`);
    const sourceRes = await fetch(url, fetchOptions);
    const sourceData = await sourceRes.json();
    const sources = sourceData?.data?.sources || sourceData?.data || [];

    if (sources.length === 0) {
      console.log(`[-] No sources found.`);
      process.exit(0);
    }

    if (modePrefix === "Embed") {
      sources.forEach((s: any, i: number) => console.log(`  ${i + 1}. [${s.host}] ${s.link}`));
      process.exit(0);
    }

    console.log("\nAvailable Qualities:");
    sources.forEach((s: any, i: number) =>
      console.log(`  [${i + 1}] ${s.quality || s.format || "Unknown"}`),
    );
    const qualityPickStr = await ask(`\nPick quality [${sources.length}]: `);
    const selectedSource =
      sources[parseInt(qualityPickStr || String(sources.length)) - 1] ||
      sources[sources.length - 1];

    // Subtitles
    let selectedSubUrl = null;
    const subRes = await fetch(
      `https://www.rivestream.app/api/backendfetch?requestID=${type}OnlineSubtitles&id=${tmdbId}&secretKey=${secretKey}&proxyMode=undefined${isTv ? `&season=${season}&episode=${episode}` : ""}`,
      fetchOptions,
    );
    if (subRes.ok) {
      try {
        const subData = await subRes.json();
        if (subData?.data?.length > 0) {
          const enSub = subData.data.find(
            (s: any) => s.lang?.toLowerCase() === "en" || s.language?.toLowerCase() === "english",
          );
          selectedSubUrl = enSub ? enSub.url : subData.data[0].url;
        }
      } catch (e) {}
    }

    console.log(`\n[*] Launching MPV...`);
    const mpvArgs = [
      selectedSource.url,
      `--user-agent=${headers["User-Agent"]}`,
      `--referrer=https://www.rivestream.app/`,
    ];
    if (selectedSubUrl) mpvArgs.push(`--sub-file=${selectedSubUrl}`);

    if (!selectedSource.url.includes('.m3u8') && !selectedSource.url.includes('.mp4')) {
        console.log(`    [!] This is an embed link. 'mpv' will automatically use 'yt-dlp' to extract the raw video.`);
    }

    spawn("mpv", mpvArgs, { stdio: "inherit" }).on("close", () => process.exit(0));
  } catch (e) {
    console.error("\n[!] Error:", e.message);
    process.exit(1);
  }
}

main();
