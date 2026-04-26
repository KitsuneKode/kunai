import * as fs from 'fs';

async function findSecretKey() {
    const files = fs.readdirSync('scratchpads/provider-rivestream/chunks');
    for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const content = fs.readFileSync('scratchpads/provider-rivestream/chunks/' + file, 'utf8');
        let index = content.indexOf('secretKey');
        while (index !== -1) {
            console.log(`Found in ${file}:`);
            console.log(content.substring(Math.max(0, index - 200), index + 200));
            index = content.indexOf('secretKey', index + 1);
        }
    }
}
findSecretKey();