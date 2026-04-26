import * as fs from 'fs';

const code = fs.readFileSync('scratchpads/provider-rivestream/chunks/_app-9e8c7e7bd380ca18.js', 'utf8');

const match = code.match(/c=\[("[^"]*",?\s*)+\]/);
if (match) {
    console.log(match[0]);
} else {
    console.log("No array assignments found.");
}
