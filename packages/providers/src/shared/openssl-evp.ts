import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Minimal port of the OpenSSL "Salted__" envelope that CryptoJS produces and
 * consumes when `AES.encrypt/decrypt` is given a string passphrase (not a
 * WordArray key): base64(`Salted__` + 8-byte salt + ciphertext), with key+IV
 * derived by EVP_BytesToKey(MD5, 1 iteration). AES-256-CBC with PKCS7 padding,
 * matching CryptoJS defaults.
 *
 * This exists because videasy/vidking payloads are encrypted server-side in
 * exactly this format; re-implementing the ~60 lines removes the `crypto-js`
 * dependency entirely.
 */

const OPENSSL_SALTED_MAGIC = "Salted__";
const AES_256_KEY_LEN = 32;
const CBC_IV_LEN = 16;

/**
 * EVP_BytesToKey as OpenSSL documents it and CryptoJS implements it:
 *   D_0 = ""; D_i = MD5(D_{i-1} + password + salt)
 *   key = D_1[0:32]; iv = D_1[32:48] || D_2[0:0]  (48 bytes = 2 digest rounds)
 * One iteration, MD5 digest.
 */
function evpBytesToKey(
  password: Buffer,
  salt: Buffer,
): { readonly key: Buffer; readonly iv: Buffer } {
  const blocks: Buffer[] = [];
  let block = Buffer.alloc(0);
  let produced = 0;
  const needed = AES_256_KEY_LEN + CBC_IV_LEN;
  while (produced < needed) {
    block = createHash("md5")
      .update(Buffer.concat([block, password, salt]))
      .digest();
    blocks.push(block);
    produced += block.length;
  }
  const material = Buffer.concat(blocks);
  return {
    key: material.subarray(0, AES_256_KEY_LEN),
    iv: material.subarray(AES_256_KEY_LEN, needed),
  };
}

/**
 * Decrypt a CryptoJS/OpenSSL passphrase-mode AES payload.
 *
 * @param ciphertextB64 base64 of `Salted__`+salt+ciphertext, or bare ciphertext
 *   (CryptoJS accepts both — a missing magic means an empty salt).
 * @param passphrase the string passphrase — CryptoJS feeds its UTF-8 bytes to
 *   EVP_BytesToKey verbatim (a hex digest string is just bytes here, NOT a key).
 * @returns the decrypted UTF-8 plaintext.
 * @throws on malformed input or bad padding (wrong passphrase/corruption).
 */
export function decryptOpensslSalted(ciphertextB64: string, passphrase: string): string {
  const raw = Buffer.from(ciphertextB64, "base64");
  let salt: Buffer;
  let ciphertext: Buffer;
  if (raw.length >= 16 && raw.subarray(0, 8).toString("latin1") === OPENSSL_SALTED_MAGIC) {
    salt = raw.subarray(8, 16);
    ciphertext = raw.subarray(16);
  } else {
    salt = Buffer.alloc(0);
    ciphertext = raw;
  }
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Encrypt with the same OpenSSL passphrase envelope — used by tests that need
 * to produce `v2:`-style payloads without keeping crypto-js around just for
 * the encrypt direction.
 */
export function encryptOpensslSalted(plaintext: string, passphrase: string): string {
  const salt = randomBytes(8);
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from(OPENSSL_SALTED_MAGIC, "latin1"), salt, ciphertext]).toString(
    "base64",
  );
}

/** SHA-256 as lowercase hex — the videasy lane hashes its token to a passphrase. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
