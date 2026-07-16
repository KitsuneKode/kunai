/**
 * Videasy / Wings / SpeedRaceLight PRNG XOR cipher.
 *
 * Extracted from player.videasy.to (chunk decrypt path used by cineby.at /
 * cineplay.to). The old Videasy API used WASM + AES; the current
 * `api.speedracelight.com` / `api.wingsdatabase.com` path uses seed + enc=2
 * with a custom PRNG XOR cipher and "mvm1" magic-byte validation.
 *
 * Flow:
 *   1. Decode base64url → Uint8Array
 *   2. Generate XOR key stream from seed string + TMDB ID
 *   3. XOR ciphertext with key stream
 *   4. Validate first 4 bytes == [109, 118, 109, 49] ("mvm1")
 *   5. Remove 4-byte header, decode as UTF-8 → JSON
 *
 * Critical: PRNG state must be a *sparse* Array(61). The player uses
 * `n in state` as a presence mask. A dense `Array.from({ length: 61 })`
 * makes every index present and produces a wrong keystream.
 */

const MAGIC_BYTES = [109, 118, 109, 49] as const;

// Golden ratio constant and PRNG parameters
const PRNG_STATE_SIZE = 61;
const PRNG_ROUNDS = 8;
const GOLDEN_RATIO = 2654435769 >>> 0;

/**
 * 32-bit finalizer hash (player bundle `w` / `ui`).
 * SplitMix64-style mixing with fixed constants.
 */
function hash32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 2246822507) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489909) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Rotate left */
function rotl(x: number, n: number): number {
  x >>>= 0;
  n &= 31;
  return n === 0 ? x >>> 0 : ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** FNV-1a 32-bit hash (unsigned), then finalizer — matches player seed hash. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash32(h);
}

/**
 * Initialize the PRNG state array from a seed string and TMDB id.
 *
 * Uses a sparse `Array(61)` so `idx in state` is false until written —
 * identical to the browser player implementation.
 */
function initPrng(seed: string, mediaId: number): { state: (number | undefined)[]; acc: number } {
  // Sparse on purpose — do NOT use Array.from({ length }) (dense undefined slots).
  const state: (number | undefined)[] = Array(PRNG_STATE_SIZE);
  let i = hash32(fnv1a(seed) ^ hash32((mediaId >>> 0) ^ GOLDEN_RATIO)) >>> 0;

  for (let r = 0; r < PRNG_ROUNDS; r++) {
    const n = i % PRNG_STATE_SIZE;
    i = rotl((i + GOLDEN_RATIO) >>> 0, 7 + (r & 7));
    state[n] = (i ^ hash32(i)) >>> 0;
    i = hash32((i + n) >>> 0);
  }

  return { state, acc: hash32(i ^ 0xa5a5a5a5) >>> 0 };
}

/**
 * Generate next 32 bits from PRNG state.
 *
 * Each call advances the internal state and produces 4 bytes of key stream.
 * The `idx in s` mask is load-bearing — sparse vs dense changes the cipher.
 */
function nextPrngWord(
  ctx: { state: (number | undefined)[]; acc: number },
  counter: number,
): number {
  const s = ctx.state;
  let a = ctx.acc;
  const idx = a % PRNG_STATE_SIZE;
  const inRange = +(idx in s) as 0 | 1;
  const mask = 0 - inRange;
  const sv = (s[idx] ?? 0) >>> 0;
  const m = Math.imul(GOLDEN_RATIO, counter + 1) >>> 0;

  let g = (((a ^ sv ^ m) >>> 0) | ((a & (sv ^ m) & mask) >>> 0)) >>> 0;
  g = (rotl((g + a) >>> 0, idx & 31) ^ rotl(a, Math.imul(idx, 7) & 31)) >>> 0;
  a = hash32((g + GOLDEN_RATIO) >>> 0);
  s[idx] = a >>> 0;
  ctx.acc = a;
  return a >>> 0;
}

/**
 * Generate XOR key stream of given length.
 *
 * Fills a Uint8Array with `length` bytes of key material
 * (4 bytes per PRNG call).
 */
function generateKeyStream(seed: string, mediaId: number, length: number): Uint8Array {
  const ctx = initPrng(seed, mediaId);
  const out = new Uint8Array(length);
  let idx = 0;
  let ctr = 0;

  while (idx < length) {
    const w = nextPrngWord(ctx, ctr++);
    out[idx++] = w & 0xff;
    if (idx < length) out[idx++] = (w >>> 8) & 0xff;
    if (idx < length) out[idx++] = (w >>> 16) & 0xff;
    if (idx < length) out[idx++] = (w >>> 24) & 0xff;
  }

  return out;
}

/** Decode base64url string to Uint8Array. */
function base64urlDecode(input: string): Uint8Array {
  const base64 = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(input.length / 4) * 4, "=");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decrypt a speedracelight / wingsdatabase "sources-with-title" response (enc=2).
 *
 * @param ciphertext  Base64url-encoded encrypted payload from the source endpoint
 * @param seed        Seed string from the seed endpoint (e.g. "59459280.cbOReg-rKU2KqjgFxFpqFu")
 * @param mediaId     Integer TMDB ID used for key derivation
 * @returns           Decrypted JSON string
 *
 * @throws {Error}    If magic bytes don't match (bad seed or tampered payload)
 */
export function decodeWingsdatabasePayload(
  ciphertext: string,
  seed: string,
  mediaId: number,
): string {
  const encrypted = base64urlDecode(ciphertext.trim());
  const keyStream = generateKeyStream(seed, mediaId, encrypted.length);

  // XOR decrypt in-place
  for (let i = 0; i < encrypted.length; i++) {
    encrypted[i] = (encrypted[i] ?? 0) ^ (keyStream[i] ?? 0);
  }

  // Validate magic bytes
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (encrypted[i] !== MAGIC_BYTES[i]) {
      throw new Error(
        `decrypt failed: bad seed or tampered payload (magic byte ${i}: expected ${MAGIC_BYTES[i]}, got ${encrypted[i]})`,
      );
    }
  }

  return new TextDecoder("utf-8").decode(encrypted.subarray(MAGIC_BYTES.length));
}
