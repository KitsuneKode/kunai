import * as fs from 'fs';

const code = fs.readFileSync('scratchpads/provider-rivestream/chunks/_app-9e8c7e7bd380ca18.js', 'utf8');
const index = code.indexOf('.toString(16).padStart(8,"0")}(i));return btoa(o)');
if (index !== -1) {
    console.log(code.substring(Math.max(0, index - 5000), index));
} else {
    console.log("Not found");
}
