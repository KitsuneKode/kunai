import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const pem = process.env.KUNAI_RELEASE_ED25519_PKCS8;
const sumsPath = process.argv[2];
const signaturePath = process.argv[3] ?? (sumsPath ? `${sumsPath}.sig` : "");

if (!pem || !sumsPath) {
  throw new Error(
    "KUNAI_RELEASE_ED25519_PKCS8 and a SHA256SUMS path are required; a checksum file is not published unsigned",
  );
}

const signature = sign(null, readFileSync(sumsPath), createPrivateKey(pem));
writeFileSync(signaturePath, signature);
console.log(`signed ${sumsPath} -> ${signaturePath}`);
