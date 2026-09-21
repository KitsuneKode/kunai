/**
 * Movy (movy.sx) source-payload decryption — a line-for-line port of the
 * client-side STREAMCRYPTO decoder shipped in the site's Next.js bundle.
 *
 * Protocol:
 *   1. `GET {api}/seed?mediaId={tmdbId}` → `{ seed, ttlMs }` (~30 s TTL).
 *   2. `GET {api}/{city}/sources?…&enc=2&seed={seed}` → base64url ciphertext.
 *   3. XOR the ciphertext with a keyed 32-bit-word keystream, verify the
 *      `mvm1` magic prefix, then decode UTF-8 JSON `{ sources, subtitles }`.
 *
 * The keystream has two KDF paths selected by seed-length parity:
 *   - odd-parity seeds → RC4-style 256-entry KSA s-box + rotate/accumulate key
 *   - even-parity seeds → sparse 61-entry s-box seeded by FNV-1a(seed) mixed
 *     with the media id, partially populated from SHA-256 round constants
 *
 * Reversal note: stream ciphers XOR symmetrically, so the same keystream both
 * encrypts and decrypts — this file only implements the decrypt direction
 * because the API only ever sends ciphertext.
 */

/** First 16 SHA-256 round constants — used as fixed key material by the KDF. */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
];

/** `"mvm1"` — decrypted payloads must start with these bytes or the seed is wrong. */
const PAYLOAD_MAGIC = [109, 118, 109, 49] as const;

const GOLDEN = 0x9e3779b9;
const SBOX_SIZE = 61;

/** `(e * (e + 1)) & 1` — true for e ≡ 0 or 3 (mod 4). */
function laneParity(e: number): boolean {
  return ((e * (e + 1)) & 1) === 0;
}

/** murmur3 fmix32 finalizer. */
function fmix(h: number): number {
  h >>>= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit rotate-left; `rotl(x, 0)` returns x. */
function rotl(x: number, amount: number): number {
  x >>>= 0;
  amount &= 31;
  return amount === 0 ? x >>> 0 : ((x << amount) | (x >>> (32 - amount))) >>> 0;
}

/** FNV-1a 32-bit over char codes, finished with fmix. */
function keyedFNV(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x1000193) >>> 0;
  return fmix(hash);
}

/** RC4-style KSA over the seed — the odd-parity s-box. */
function oddSeedSBox(seed: string): number[] {
  const s: number[] = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    const si = s[i] ?? 0;
    j = (j + si + seed.charCodeAt(i % seed.length)) & 255;
    s[i] = s[j] ?? 0;
    s[j] = si;
  }
  return s;
}

/** Rotate/xor accumulator over the seed — the odd-parity acc seed. */
function oddSeedAcc(seed: string): number {
  let acc = 0x67452301;
  for (let i = 0; i < seed.length; i++) {
    acc = rotl((acc ^ Math.imul(seed.charCodeAt(i), SHA256_K[15 & i] ?? 0)) >>> 0, 5);
  }
  return fmix(acc);
}

/**
 * The s-box is intentionally a `Record`, not an array — the even-parity KDF
 * leaves most of the 61 slots unset and the keystream step branches on
 * `slot in s`, which only reports holes correctly for a plain object.
 */
type Keystream = { s: Record<number, number>; acc: number };

function initKeystream(seed: string, mediaId: number): Keystream {
  if ((seed.length * (seed.length + 1)) & 1) {
    const sbox = oddSeedSBox(seed);
    const record: Record<number, number> = {};
    for (let i = 0; i < sbox.length; i++) record[i] = sbox[i] ?? 0;
    return { s: record, acc: oddSeedAcc(seed) };
  }
  const s: Record<number, number> = {};
  let n = fmix(keyedFNV(seed) ^ fmix((mediaId >>> 0) ^ GOLDEN)) >>> 0;
  for (let i = 0; i < 8; i++) {
    if (laneParity(i)) {
      const slot = n % SBOX_SIZE;
      n = rotl((n + GOLDEN) >>> 0, 7 + (7 & i));
      s[slot] = (n ^ fmix(n)) >>> 0;
      n = fmix((n + slot) >>> 0);
    } else {
      s[i] = SHA256_K[15 & i] ?? 0;
    }
  }
  return { s, acc: fmix(0xa5a5a5a5 ^ n) >>> 0 };
}

/** Advance the keystream; returns the next 32-bit word (little-endian bytes). */
function nextWord(ks: Keystream, counter: number): number {
  const s = ks.s;
  const acc = ks.acc;
  const slot = acc % SBOX_SIZE;
  const inTable = 0 - Number(slot in s);
  const r = (s[slot] ?? 0) >>> 0;
  const c = Math.imul(GOLDEN, counter + 1) >>> 0;
  const mixed = (r ^ c) >>> 0;
  const b = (((acc ^ mixed) >>> 0) | ((acc & mixed & inTable) >>> 0)) >>> 0;
  const next = fmix(
    (((rotl((b + acc) >>> 0, 31 & slot) ^ rotl(acc, 31 & Math.imul(slot, 7))) >>> 0) + GOLDEN) >>>
      0,
  );
  s[slot] = next >>> 0;
  ks.acc = next;
  return next >>> 0;
}

function decodeBase64Url(payload: string): Uint8Array {
  const normalized = payload
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(4 * Math.ceil(payload.length / 4), "=");
  return new Uint8Array(Buffer.from(normalized, "base64"));
}

export class MovyDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MovyDecryptError";
  }
}

/**
 * Decrypt a `/{city}/sources?enc=2` response body. Throws {@link MovyDecryptError}
 * when the magic check fails (wrong seed / tampered payload).
 */
export function decryptMovyPayload(payload: string, seed: string, mediaId: number): string {
  const cipher = decodeBase64Url(payload);
  const ks = initKeystream(seed, mediaId);
  const keystream = new Uint8Array(cipher.length);
  let counter = 0;
  for (let i = 0; i < cipher.length;) {
    const word = nextWord(ks, counter++);
    keystream[i++] = word & 255;
    if (i < cipher.length) keystream[i++] = (word >>> 8) & 255;
    if (i < cipher.length) keystream[i++] = (word >>> 16) & 255;
    if (i < cipher.length) keystream[i++] = (word >>> 24) & 255;
  }
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) plain[i] = (cipher[i] ?? 0) ^ (keystream[i] ?? 0);
  for (let i = 0; i < PAYLOAD_MAGIC.length; i++) {
    if (plain[i] !== PAYLOAD_MAGIC[i]) {
      throw new MovyDecryptError("decrypt failed: bad seed or tampered payload");
    }
  }
  return new TextDecoder().decode(plain.subarray(PAYLOAD_MAGIC.length));
}
