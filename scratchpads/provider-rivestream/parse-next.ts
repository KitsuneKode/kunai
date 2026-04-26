import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';

const html = readFileSync('scratchpads/rivestream/rivestream.html', 'utf8');
const $ = cheerio.load(html);

const nextDataStr = $('#__NEXT_DATA__').html();
if (nextDataStr) {
    const data = JSON.parse(nextDataStr);
    console.log(JSON.stringify(data.props.pageProps, null, 2));
} else {
    console.log("No next data");
}
