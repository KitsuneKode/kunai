import Hashids from "hashids";

function UsExact(e: string) {
    const s = String(e);
    const n = (i: string) => i.split("").map((l: string) => l.charCodeAt(0));
    const a = new Hashids();
    const o = n("8c465aa8af6cbfd4c1f91bf0c8d678ba");
    
    // Exact copy of their logic
    const mapped = s.split("").map(n).map(i => i.map((d, m) => d ^ o[m % o.length])).flat().map(i => ("0" + Number(i).toString(16)).substr(-2)).join("");
    
    // They used a.encode() with a string.
    console.log("Hex string to encode:", mapped);
    
    try {
        // Let's pass the string directly to encode to see what Hashids v2.2.10 (or v2.3.0) does
        // Actually, Hashids encode can take a string and it converts it to array of numbers or parses it.
        // Wait, if it parses it, a string like "39323735..." is parsed as an integer.
        // But "39..." is way larger than MAX_SAFE_INTEGER.
        // In Hashids, if you pass a string, it checks if it's hex?
        // Hashids v2: encodeHex is for hex. If they called encode(), what happens?
        return a.encode(mapped as any);
    } catch(e) {
        console.log("encode() failed:", e.message);
    }
    
    // Maybe they passed a BigInt?
    try {
        return a.encode(BigInt("0x" + mapped) as any);
    } catch(e) {
        console.log("encode(BigInt) failed:", e.message);
    }
    
    // What about encodeHex?
    return a.encodeHex(mapped);
}

console.log("UsExact output:", UsExact("127529d486ae1ce6fdbe63b60bd1704541fcf0"));
