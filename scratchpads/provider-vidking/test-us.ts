import Hashids from "hashids";

function Us(e: string) {
    const s = String(e);
    const n = (i: string) => i.split("").map((l: string) => l.charCodeAt(0));
    const a = new Hashids();
    const o = n("8c465aa8af6cbfd4c1f91bf0c8d678ba");
    
    const mapped = s.split("").map(n).map(i => i.map((d, m) => d ^ o[m % o.length])).flat();
    const hex = mapped.map(i => ("0" + Number(i).toString(16)).substr(-2)).join("");
    console.log("Hex before encode:", hex);
    
    // The obfuscated code uses .encode() but with a string of hex!
    // Hashids encode expects numbers. Passing a hex string to encode might parse it as a number 
    // or fail if it has letters. Let's see what Hashids v2.3.0 (which we installed) does.
    try {
        return a.encode(hex as any); // cast to any to allow string
    } catch(e) {
        console.log("encode(hex) threw:", e.message);
        // Maybe they meant encodeHex?
        console.log("Trying encodeHex...");
        return a.encodeHex(hex);
    }
}

console.log(Us("127529d486ae1ce6fdbe63b60bd1704541fcf0"));
