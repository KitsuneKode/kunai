import { readFile, writeFile } from 'fs/promises';
import wabt from 'wabt';

async function main() {
    try {
        const wasm = await readFile('scratchpads/vidking_assets/module1.wasm');
        const wabtModule = await wabt();
        const module = wabtModule.readWasm(wasm, { readDebugNames: true });
        const wat = module.toText({});
        await writeFile('scratchpads/module1.wat', wat);
        console.log("Successfully decompiled to scratchpads/module1.wat");
    } catch (e) {
        console.error("Error:", e);
    }
}
main();