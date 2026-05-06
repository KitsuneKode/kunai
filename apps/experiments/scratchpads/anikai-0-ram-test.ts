async function testAnikaiZeroRam() {
    console.log("=========================================");
    console.log(" ANIKAI PURE 0-RAM TEST (NO PLAYWRIGHT)");
    console.log("=========================================\n");

    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    };

    console.log("[*] Attempting raw fetch to Anikai homepage...");
    try {
        const res = await fetch("https://anikai.to/home", { headers });
        console.log(`    -> Status: ${res.status} ${res.statusText}`);
        
        const html = await res.text();
        if (html.includes("Just a moment...") || html.includes("Cloudflare") || res.status === 403) {
            console.log(`    [!] BLOCKED. Cloudflare IUAM/Turnstile intercepted the raw fetch.`);
            console.log(`    [!] Conclusion: A pure 0-RAM fetch is impossible for Anikai's frontend.`);
            console.log(`    [!] We MUST use the Harvest & Fetch (Playwright) model.`);
        } else {
            console.log(`    [+] SUCCESS? Wait, did we bypass it? HTML snippet: ${html.substring(0, 100)}`);
        }
    } catch (e) {
        console.error(`    [!] Fatal Network Error (Likely ECONNRESET from Cloudflare TLS fingerprinting):`, e.message);
        console.log(`    [!] Conclusion: A pure 0-RAM fetch is impossible. We MUST use Playwright to harvest.`);
    }
}

testAnikaiZeroRam();
