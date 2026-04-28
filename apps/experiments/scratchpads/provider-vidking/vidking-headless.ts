import { readFile } from "fs/promises";
import loader from "@assemblyscript/loader";
import CryptoJS from "crypto-js";

(async () => {
  const wasmBuffer = await readFile("module1_patched.wasm");
  const env = {
    seed: () => Date.now(),
    abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
      console.error(`WASM ABORT: line ${line}:${col}`);
    },
  };
  const wasmModule = await loader.instantiate(wasmBuffer, { env });
  const n = wasmModule.exports as any;

  const payloadBuffer = await readFile("sources.bin");
  const payload = payloadBuffer.toString("utf8").trim();
  const tmdbId = 127529;

  try {
    const payloadPtr = n.__newString(payload);
    const decryptedPtr = n.decrypt(payloadPtr, tmdbId);
    const wasmDecryptedHex = n.__getString(decryptedPtr);

    console.log("WASM Decrypted hex prefix:", wasmDecryptedHex.substring(0, 50));

    // Try to decrypt with empty string as key
    const aesKey = "";

    const decryptedBytes = CryptoJS.AES.decrypt(wasmDecryptedHex, aesKey);
    const finalJSON = decryptedBytes.toString(CryptoJS.enc.Utf8);
    console.log("FINAL DECRYPTED SOURCES (empty key):");
    console.log(finalJSON.substring(0, 500));
  } catch (e) {
    console.error("Decryption failed with empty key:", e.message);
  }
})();
