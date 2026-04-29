# Kunai File Host Extractors (Forcing the Raw Video) 🥷✨

This document outlines the strategy for forcing the raw, unadulterated `.mp4` or `.m3u8` video streams out of 3rd-party file hosts (like MegaUp, Streamtape, Mp4Upload, Vidstreaming) that are embedded by wrappers like Anikai.

Because the Kunai Web App cannot run `yt-dlp` or Playwright locally, we must build lightweight TypeScript extractors that run in the browser to maintain a 100% ad-free, custom UI.

---

## 1. The Anatomy of a File Host
When Anikai provides an embed link (e.g., `https://megaup.nl/e/XYZ`), they do not provide the raw video. MegaUp hosts the video, but they wrap it in a player filled with aggressive pop-up ads and invisible click-jackers.

To stop automated scrapers from simply reading the `<video src="...">` tag, file hosts use **JavaScript Packers** (like the classic Dean Edwards `eval(function(p,a,c,k,e,d)...` obfuscator) to dynamically generate the video link only when the page renders.

---

## 2. The Extractor Architecture (Client-Side Unpacking)
You correctly noted: *"Everything ultimately comes here in the browser right?"*

Yes. No matter how much math or obfuscation the file host uses, the browser *must* eventually resolve the raw `.mp4` string to feed it to the video player. We exploit this.

Inside the `@kunai/scraper-core` package, we will build a dedicated `/extractors` module:

1. **The Route:** When Anikai returns a `megaup.nl` link, the core engine passes it to the `MegaUpExtractor`.
2. **The Proxy Fetch:** The Extractor uses the Cloudflare CORS Proxy (`proxy.kunai.app`) to download the raw HTML of the `megaup.nl` page to the user's local browser/CLI.
3. **The Unpacker:** We use a lightweight TypeScript Regex parser to find the `eval(...)` block. We pass that string into a safe, open-source JS Unpacker library (which just reverse-engineers the compression).
4. **The Regex Extraction:** The unpacked string will be plain, readable JavaScript. We run a simple Regex (e.g., `/source:\s*['"](.*?\.(mp4|m3u8))['"]/`) to instantly pluck the raw video URL.

---

## 3. The Extraction Fallback Ladder
We will focus our efforts on building custom TypeScript extractors for the top 5 most common file hosts used by Anime sites:
1. `Streamtape`
2. `Vidstreaming` / `GogoCDN`
3. `Mp4Upload`
4. `MegaUp`
5. `Doodstream`

**What happens if an obscure file host changes their obfuscation?**
If `Mp4Upload` breaks our TypeScript extractor tomorrow, the user does not get an error. 
*   **Web Users:** Kunai intelligently falls back to the *Native Filter*. It silently switches from Anikai to Miruro or Vidking to find a direct HLS stream. 
*   **CLI/Desktop Users:** The local daemon bypasses the broken TypeScript extractor and falls back to `yt-dlp` (which is maintained globally by a massive open-source community), ripping the `.mp4` flawlessly. 

By building these lightning-fast, 0-RAM TypeScript extractors, the Web App becomes completely independent. We force the raw video out of Anikai, strip away the malware ads, and serve it seamlessly inside our beautiful `ArtPlayer` UI.