import * as cheerio from 'cheerio';
import { readFile } from 'fs/promises';

async function test() {
   const html = await readFile('scratchpads/series.html', 'utf-8');
   const $ = cheerio.load(html);
   
   console.log("IFRAME:", $('iframe').attr('src'));
   
   console.log("SERVERS:");
   $('.server-item, .btn-server, [data-id]').each((i, el) => {
       const text = $(el).text().trim().replace(/\s+/g, ' ');
       const id = $(el).attr('data-id') || $(el).attr('data-linkid') || 'none';
       const cls = $(el).attr('class') || 'none';
       if (text.includes("cloud") || cls.includes("server")) {
           console.log(`Text: ${text} | ID: ${id} | Class: ${cls}`);
       }
   });
}
test();