import { readFile } from "fs/promises";
import loader from "@assemblyscript/loader";

(async () => {
    const wasmBuffer = await readFile("vidking_assets/module1.wasm");
    
    const env = {
        seed: () => Date.now(),
        abort: () => { console.error("abort"); }
    };
    
    // instantiate returns { exports: ... }
    const wasmModule = await loader.instantiate(wasmBuffer, { env });
    const n = wasmModule.exports as any;
    
    console.log("Keys on exported module:", Object.keys(n));
    
    const payloadBuffer = await readFile("sources.bin");
    const payload = payloadBuffer.toString("utf8"); // Hex string
    const tmdbId = 127529;
    
    try {
        // Can we decrypt without verifying?
        const resultPtr = n.decrypt(n.__newString(payload), tmdbId);
        const resultStr = n.__getString(resultPtr);
        console.log("Decrypted WASM payload:", resultStr.substring(0, 100) + "...");
    } catch (e) {
        console.error("Failed to decrypt without verify:", e);
    }
})();
