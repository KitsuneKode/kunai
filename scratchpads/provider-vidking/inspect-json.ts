import { readFile } from "fs/promises";
import loader from "@assemblyscript/loader";
import CryptoJS from "crypto-js";

(async () => {
    const wasmBuffer = await readFile("scratchpads/module1_patched.wasm");
    const env = {
        seed: () => Date.now(),
        abort: () => {}
    };
    const wasmModule = await loader.instantiate(wasmBuffer, { env });
    const n = wasmModule.exports as any;
    
    const payloadBuffer = await readFile("scratchpads/sources.bin");
    const payload = payloadBuffer.toString("utf8").trim(); 
    const tmdbId = 127529;
    
    const payloadPtr = n.__newString(payload);
    const decryptedPtr = n.decrypt(payloadPtr, tmdbId);
    const wasmDecryptedHex = n.__getString(decryptedPtr);
    
    const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedHex, "");
    const finalJSONStr = decryptedBytes.toString(CryptoJS.enc.Utf8);
    const streamData = JSON.parse(finalJSONStr);
    
    console.log(JSON.stringify(streamData, null, 2));
})();