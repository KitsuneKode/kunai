import { readFile } from "fs/promises";

async function testDecryption() {
    const payloadBuffer = await readFile("sources.bin");
    const payload = payloadBuffer.toString("utf8").trim();
    
    let b = 127529;
    const key = new Uint8Array(50);
    for (let i = 0; i < 50; i++) {
        b = (b * 1103515245 + 12345) % 2147483648;
        key[i] = Math.floor(b % 255) & 255;
    }
    
    let decryptedBytes = new Uint8Array(payload.length / 2);
    for (let i = 0; i < payload.length; i += 2) {
        const hexByte = parseInt(payload.substring(i, i + 2), 16);
        const keyByte = key[(i / 2) % key.length];
        decryptedBytes[i / 2] = hexByte ^ keyByte;
    }
    
    const prefix = Array.from(decryptedBytes.slice(0, 8)).map(b => String.fromCharCode(b)).join('');
    console.log("Prefix is:", prefix);
    
    console.log("First 20 chars mapped:", Array.from(decryptedBytes.slice(0, 20)).map(b => String.fromCharCode(b)).join(''));
    console.log("First 20 bytes:", decryptedBytes.slice(0, 20));
}

testDecryption().catch(console.error);