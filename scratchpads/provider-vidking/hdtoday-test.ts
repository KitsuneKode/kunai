import * as cheerio from 'cheerio';

async function verify() {
    const url = `https://www.hdtoday.gd/series/127529`;
    console.log("Fetching: " + url);
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    const $ = cheerio.load(html);
    
    console.log("Iframe source:");
    console.log($('iframe').attr('src'));
    
    console.log("\nServer buttons:");
    $('.server-item, [class*="server"]').each((i, el) => {
        console.log($(el).text().trim());
    });
}
verify();