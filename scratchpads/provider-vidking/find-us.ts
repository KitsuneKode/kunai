import * as fs from 'fs';

const code = fs.readFileSync('vidking_assets/VideoPlayer-DJDza8PA.js', 'utf8');
const index = code.indexOf('async function Us(e)');
if (index !== -1) {
    console.log(code.substring(index, index + 400));
} else {
    console.log("not found");
}
