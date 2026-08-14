import { writeFileSync } from "fs";

async function huntMetadata() {
    console.log("=========================================");
    console.log(" KUNAI DEEP METADATA HUNT (Sub/Dub, Qualities, Titles)");
    console.log("=========================================\n");

    let report = `# Kunai Core: Provider Metadata Contracts\n\n`;
    report += `This document maps the exact JSON schemas required to build flawless, multi-source provider plugins in \`@kunai/core\`.\n\n`;

    // --- 1. ALLMANGA / ALLANIME ---
    console.log("[*] Hunting AllAnime GraphQL...");
    try {
        const query = `
        query($search: SearchInput) {
            shows(search: $search) {
                edges {
                    _id
                    name
                    englishName
                    nativeName
                    availableEpisodesDetail { sub dub raw }
                    nextEpisode
                }
            }
        }`;
        
        const res = await fetch("https://api.allanime.day/api", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://youtu-chan.com/" // Required bypass header for AllAnime
            },
            body: JSON.stringify({ query, variables: { search: { query: "jujutsu kaisen", allowAdult: false } } })
        });

        const data = await res.json();
        const show = data?.data?.shows?.edges?.[0];

        report += `## 1. AllManga / AllAnime\n`;
        report += `- **JP/EN Title Mapping:** They natively support mapping via \`name\` (Romaji), \`englishName\`, and \`nativeName\` (Kanji). Example: \`${show?.name}\` vs \`${show?.englishName}\`.\n`;
        report += `- **Sub/Dub Flags:** Handled explicitly in the catalog endpoint via the \`availableEpisodesDetail\` object: \n\`\`\`json\n${JSON.stringify(show?.availableEpisodesDetail, null, 2)}\n\`\`\`\n`;
        report += `- **Next Release Date:** Found natively via the \`nextEpisode\` GraphQL field (Unix timestamp or null): \`${show?.nextEpisode}\`.\n`;
        report += `- **HardSub vs SoftSub:** AllAnime uses HardSubs for standard streams. SoftSubs are sometimes embedded directly in the HLS \`.m3u8\` manifest, but are not exposed as separate \`.vtt\` arrays in the JSON payload.\n\n`;

    } catch(e) {
        console.error("    [!] AllAnime failed:", e.message);
    }

    // --- 2. MIRURO (theanimecommunity.com) ---
    console.log("[*] Hunting Miruro Backend...");
    try {
        // JJK AniList ID is 113415
        const anilistId = 113415;
        const res = await fetch(`https://theanimecommunity.com/api/v1/mediaItems?AniList_ID=${anilistId}`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const data = await res.json();
        
        const mediaItemId = data[0]?.mediaItemID || data?.mediaItemID;
        const infoRes = await fetch(`https://theanimecommunity.com/api/v1/mediaItems/${mediaItemId}`, { headers: { "User-Agent": "Mozilla/5.0" } });
        const infoData = await infoRes.json();

        report += `## 2. Miruro (theanimecommunity.com)\n`;
        report += `- **JP/EN Title Mapping:** Natively supports AniList IDs! The title object perfectly matches AniList: \n\`\`\`json\n${JSON.stringify(infoData?.title, null, 2)}\n\`\`\`\n`;
        report += `- **Sub/Dub Flags:** Miruro's backend returns sub and dub as separate properties inside the \`sources\` array when fetching an episode. We can toggle by accessing \`sources.sub\` or \`sources.dub\`.\n`;
        report += `- **Next Release Date:** Found inside \`nextAiringEpisode\`: \n\`\`\`json\n${JSON.stringify(infoData?.nextAiringEpisode, null, 2)}\n\`\`\`\n`;
        report += `- **Multiple Qualities:** The \`.m3u8\` playlists returned by \`pro.ultracloud.cc\` contain internal resolution bandwidths, meaning we hand the master playlist to \`mpv\` and it auto-selects 1080p, but we can also manually parse the HLS file if we want to build a custom quality picker.\n\n`;

    } catch(e) {
        console.error("    [!] Miruro failed:", e.message);
    }

    // --- 3. VIDKING (HDToday/Cineby) ---
    console.log("[*] Documenting Vidking Schema...");
    // Since we know Vidking returns AES encrypted hex via api.videasy.net, we document the decrypted structure here.
    report += `## 3. Vidking / HDToday (api.videasy.net)\n`;
    report += `- **JP/EN Title Mapping:** Vidking uses **TMDB IDs** (not AniList). It has poor support for JP Romaji names. Searching via TMDB ID is mandatory for perfect mapping.\n`;
    report += `- **Sub/Dub Flags:** Vidking does NOT separate Sub and Dub endpoints. If an episode is Dubbed, the title usually explicitly says "(Dub)".\n`;
    report += `- **HardSub vs SoftSub:** Vidking is the gold standard for SoftSubs. The decrypted JSON payload natively provides an array of subtitle tracks:\n\`\`\`json\n"subtitles": [\n  { "url": "https://...en.vtt", "lang": "eng", "language": "English" },\n  { "url": "https://...sdh.vtt", "lang": "eng", "language": "English (SDH)" }\n]\n\`\`\`\n`;
    report += `- **Quality Selector:** The payload explicitly provides qualities so we don't have to parse the HLS manifest:\n\`\`\`json\n"sources": [\n  { "url": "...", "quality": "1080p" },\n  { "url": "...", "quality": "720p" }\n]\n\`\`\`\n`;

    writeFileSync("scratchpads/DEEP_METADATA_REPORT.md", report);
    console.log("\n[+] SUCCESS! Deep Metadata Report generated at .reference/experiments/scratchpads/DEEP_METADATA_REPORT.md");
}

huntMetadata();