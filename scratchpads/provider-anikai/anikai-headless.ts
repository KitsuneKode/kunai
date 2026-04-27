import { chromium } from "playwright";
import * as cheerio from "cheerio";
import * as readline from "readline";
import { spawn } from "child_process";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

async function main() {
  process.title = "anikai-scraper";
  console.log("=========================================");
  console.log(" ANIKAI.TO HEADLESS HYBRID SCRAPER");
  console.log(" (Fast Sniff + 0 RAM Fetch)");
  console.log("=========================================\n");

  const query = process.argv[2] || (await ask("Enter anime to search: "));

  console.log(`\n[*] Searching Anikai for "${query}"...`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // 1. Perform Search
  await page.goto(`https://anikai.to/browser?keyword=${encodeURIComponent(query)}`, {
    waitUntil: "commit",
  });
  try {
    await page.waitForSelector(".aitem", { timeout: 15000 });
  } catch (e) {
    console.error("[!] Results did not appear.");
    await browser.close();
    process.exit(1);
  }

  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".aitem"));
    return items
      .map((el) => {
        const title = el.querySelector(".title")?.textContent?.trim() || "";
        const href = el.querySelector("a.poster")?.getAttribute("href") || "";
        const aniId = el.querySelector("button.ttip-btn")?.getAttribute("data-tip") || "";
        return { title, slug: href.split("/").pop(), aniId };
      })
      .filter((r) => r.slug && r.aniId);
  });

  if (results.length === 0) {
    console.error("[!] No results parsed from page.");
    await browser.close();
    process.exit(1);
  }

  results.slice(0, 10).forEach((r, i) => console.log(`  [${i + 1}] ${r.title}`));
  const pickStr = await ask("\nPick anime [1]: ");
  const selected = results[parseInt(pickStr || "1") - 1] || results[0];

  // 2. Capture Session Token and Cookies
  console.log(`\n[*] Capturing session token and cookies for ${selected.title}...`);
  let sessionToken = "";
  let cookies = "";

  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("ajax/")) {
      const parts = url.split("&_=");
      if (parts.length > 1 && !sessionToken) {
        sessionToken = parts[1];
        const h = res.request().headers();
        if (h["cookie"]) cookies = h["cookie"];
      }
    }
  });

  try {
    await page.goto(`https://anikai.to/watch/${selected.slug}`, { waitUntil: "networkidle" });
    let retries = 0;
    while (!sessionToken && retries < 40) {
      await new Promise((r) => setTimeout(r, 500));
      retries++;
    }
  } catch (e) {}

  await browser.close();

  if (!sessionToken) {
    console.error("[!] Could not capture session token.");
    process.exit(1);
  }
  console.log(`[+] Session Token & Cookies Captured.`);

  const fetchHeaders = {
    "User-Agent": userAgent,
    "X-Requested-With": "XMLHttpRequest",
    Referer: `https://anikai.to/watch/${selected.slug}`,
    Cookie: cookies,
    Accept: "application/json, text/javascript, */*; q=0.01",
  };

  // 3. Fetch Episode List (Pure Fetch)
  console.log(`[*] Fetching episode list...`);
  const epRes = await fetch(
    `https://anikai.to/ajax/episodes/list?ani_id=${selected.aniId}&_=${sessionToken}`,
    {
      headers: fetchHeaders,
    },
  );
  const epData = await epRes.json();
  const $ep = cheerio.load(epData.result);
  const episodes: any[] = [];
  $ep("a[token]").each((i, el) => {
    const epNum = $ep(el).attr("num");
    const token = $ep(el).attr("token");
    if (token) episodes.push({ epNum, token });
  });

  if (episodes.length === 0) {
    console.error("[!] No episodes found in the list.");
    process.exit(1);
  }

  console.log(`[+] Found ${episodes.length} episodes.`);
  const epPickStr = await ask(`\nPick episode [${episodes.length}]: `);
  const selectedEp =
    episodes[parseInt(epPickStr || String(episodes.length)) - 1] || episodes[episodes.length - 1];

  // 4. Fetch Links (Pure Fetch)
  console.log(`[*] Fetching video links for episode ${selectedEp.epNum}...`);
  const linkRes = await fetch(
    `https://anikai.to/ajax/links/list?token=${selectedEp.token}&_=${sessionToken}`,
    {
      headers: fetchHeaders,
    },
  );
  const linkData = await linkRes.json();
  const $link = cheerio.load(linkData.result);
  const servers: any[] = [];
  $link(".server").each((i, el) => {
    const name = $link(el).text().trim();
    const sid = $link(el).attr("data-sid");
    const eid = $link(el).attr("data-eid");
    const lid = $link(el).attr("data-lid");
    const group = $link(el).closest(".server-items").attr("data-id");
    if (sid && eid && lid) servers.push({ name, sid, eid, lid, group });
  });

  console.log("\nAvailable Servers:");
  servers.forEach((s, i) => console.log(`  [${i + 1}] [${s.group.toUpperCase()}] ${s.name}`));
  const srvPickStr = await ask("\nPick server [1]: ");
  const selectedSrv = servers[parseInt(srvPickStr || "1") - 1] || servers[0];

  // 5. Extract Final Link (Pure Fetch)
  console.log(`[*] Extracting final stream link from ${selectedSrv.name}...`);
  const finalRes = await fetch(
    `https://anikai.to/ajax/sources/extract?eid=${selectedSrv.eid}&lid=${selectedSrv.lid}&sid=${selectedSrv.sid}&_=${sessionToken}`,
    {
      headers: fetchHeaders,
    },
  );
  const finalData = await finalRes.json();

  if (finalData.status !== "ok" || !finalData.result?.url) {
    console.error("[!] Failed to extract final stream URL.");
    process.exit(1);
  }

  const m3u8Url = finalData.result.url;
  console.log(`\n[+] SUCCESS! Master M3U8 URL extracted:`);
  console.log(`    -> ${m3u8Url}`);

  spawn("mpv", [m3u8Url, `--referrer=https://anikai.to/`, `--user-agent=${userAgent}`], {
    stdio: "inherit",
  }).on("close", () => process.exit(0));
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
