import { createCipheriv, createHash, createHmac } from "node:crypto";

import type { ProviderRuntimeContext } from "@kunai/types";

import { providerFetch } from "../runtime/fetch";

/**
 * AllManga / mkissa client-crypto (post-2026-08 buildId scheme).
 *
 * Upstream left the ani-cli `72d7f72` "no buildId / scrape epoch+partB from HTML"
 * path. Live mkissa now:
 * - ships `buildId` `"119"` and four base64 mask fragments in the app chunk
 * - boots keys via `GET /client-crypto/v1/bootstrap?buildId=&k=` with
 *   `x-build-id` + HMAC `x-aa-boot` (`aa-boot:{buildId}` then payload)
 * - signs `aaReq` as AES-GCM over `{v,ts,epoch,buildId,qh,k}` with IV
 *   `SHA-256(epoch:buildId:qh:ts:k)[0:12]`
 * - rotates the epoch scale: 7-day epochs (604800000 ms), 1-day grace
 *
 * Mask fragments and buildId are recovered from the rotated string table in
 * `cdn.mkissa.net/.../chunks/*.js` (same values as browser `Cf` / `ud`).
 * The episode persisted-query hash is SHA-256 of the interpolated `_9`
 * episode GraphQL template in the crypto chunk (re-derived 2026-08-17).
 */

export const ALLMANGA_BUILD_ID = "119";
export const ALLMANGA_QUERY_HASH =
  "ca735f1436927eaf7abb05d1589bb93c43cf606d87eecc2030357c1aad8fb455";
/** Episode GraphQL lane (`Lf` → `k7`). */
export const ALLMANGA_CONTENT_LANE_EPISODE = "k7";
export const ALLMANGA_KEY_GROUP = "mkissa";
export const ALLMANGA_BOOTSTRAP_URL = "https://api.mkissa.net/client-crypto/v1/bootstrap";
export const ALLMANGA_SITE_ORIGIN = "https://mkissa.to";

/** Epoch length (ms) and near-boundary grace from live bootstrap JSON. */
export const ALLMANGA_EPOCH_MS = 604_800_000;
export const ALLMANGA_EPOCH_GRACE_MS = 86_400_000;
/** aaReq timestamp bucket (5 minutes). */
export const ALLMANGA_AA_REQ_BUCKET_MS = 300_000;

/**
 * Base64 8-byte mask fragments (`ud`) from the mkissa crypto chunk after
 * string-table rotation. Combined with `hashBuildId(buildId)` in `deriveMaskKey`.
 */
export const ALLMANGA_MASK_FRAGMENTS = [
  "hbFWg2oyTVE=",
  "5kzA8QKXvTE=",
  "ROxjxlPAJ+8=",
  "TdpAYUVrag8=",
] as const;

/** How long derived crypto material stays trusted before a lazy refetch. */
export const ALLMANGA_CRYPTO_MATERIAL_TTL_MS = 6 * 60 * 60 * 1000;

export type AllMangaCryptoMaterial = {
  readonly keyHex: string;
  readonly epoch: number;
  readonly queryHash: string;
  readonly buildId: string;
  readonly contentLane: string;
};

/** Last-known-good material when bootstrap fails (epoch 2954, build 119). */
export const ALLMANGA_KEY_HEX = "cf5487de30b64387b21614d641cfcf6174d7f3e24f2e9c6433c916c867db8a1d";
export const ALLMANGA_EPOCH = 2954;

export const BUNDLED_ALLMANGA_CRYPTO: AllMangaCryptoMaterial = {
  keyHex: ALLMANGA_KEY_HEX,
  epoch: ALLMANGA_EPOCH,
  queryHash: ALLMANGA_QUERY_HASH,
  buildId: ALLMANGA_BUILD_ID,
  contentLane: ALLMANGA_CONTENT_LANE_EPISODE,
};

export function hashBuildId(buildId: string): Buffer {
  const text = buildId || "";
  const out = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 1) {
    out[index] =
      (text.charCodeAt(index % Math.max(text.length, 1)) || 0) ^ ((index * 17 + 31) & 255);
  }
  return out;
}

/** Port of mkissa `ev(buildId)` — 32-byte mask key material. */
export function deriveMaskKey(
  buildId: string = ALLMANGA_BUILD_ID,
  fragments: readonly string[] = ALLMANGA_MASK_FRAGMENTS,
): Buffer {
  const hashed = hashBuildId(buildId);
  const out = Buffer.alloc(32);
  for (let fragmentIndex = 0; fragmentIndex < 4; fragmentIndex += 1) {
    const fragment = Buffer.from(fragments[fragmentIndex] ?? "", "base64");
    const offset = fragmentIndex * 8;
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      out[offset + byteIndex] =
        (fragment[byteIndex] ?? 0) ^
        (hashed[offset + byteIndex] ?? 0) ^
        (((fragmentIndex * 41 + byteIndex * 7) & 255) >>> 0);
    }
  }
  return out;
}

export function deriveKeyFromPartB(partB: string, buildId: string = ALLMANGA_BUILD_ID): Buffer {
  const mask = deriveMaskKey(buildId);
  const part = Buffer.from(partB, "base64");
  if (part.length !== 32) {
    throw new Error(`invalid partB length ${part.length}`);
  }
  const key = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 1) {
    key[index] = (mask[index] ?? 0) ^ (part[index] ?? 0);
  }
  return key;
}

export function currentAllMangaEpochCandidates(nowMs: number = Date.now()): readonly number[] {
  const current = Math.floor(nowMs / ALLMANGA_EPOCH_MS);
  const nearBoundary = nowMs - current * ALLMANGA_EPOCH_MS < ALLMANGA_EPOCH_GRACE_MS && current > 0;
  return nearBoundary ? [current - 1, current] : [current];
}

function hmacSha256Hex(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

/**
 * Port of mkissa `tw` → `x-aa-boot`.
 * First HMAC message is `aa-boot:{buildId}`; second covers
 * `{buildId}:{keyGroup}:{host}:{epoch}:{lane}`.
 */
export function buildAllMangaBootToken(options: {
  readonly buildId?: string;
  readonly epoch: number;
  readonly keyGroup?: string;
  readonly refererHost?: string;
  readonly contentLane?: string;
}): string {
  const buildId = options.buildId ?? ALLMANGA_BUILD_ID;
  const keyGroup = options.keyGroup ?? ALLMANGA_KEY_GROUP;
  const host = String(options.refererHost ?? "mkissa.to")
    .toLowerCase()
    .replace(/^www\./, "");
  const lane = options.contentLane?.trim() ?? "";
  const mask = deriveMaskKey(buildId);
  const inner = Buffer.from(hmacSha256Hex(mask, `aa-boot:${buildId}`), "hex");
  const payload = lane
    ? `${buildId}:${keyGroup}:${host}:${options.epoch}:${lane}`
    : `${buildId}:${keyGroup}:${host}:${options.epoch}`;
  return hmacSha256Hex(inner, payload);
}

/**
 * Build the AllAnime `aaReq` attestation.
 * Layout: base64(0x01 || iv12 || ciphertext || gcmTag16)
 * iv = SHA-256(`${epoch}:${buildId}:${qh}:${ts}:${k}`)[0:12]
 * plaintext = `{"v":1,"ts","epoch","buildId","qh","k"}`
 */
export function buildAllMangaAaReq(
  nowMs: number = Date.now(),
  material: AllMangaCryptoMaterial = BUNDLED_ALLMANGA_CRYPTO,
): string {
  const ts = Math.floor(nowMs / ALLMANGA_AA_REQ_BUCKET_MS) * ALLMANGA_AA_REQ_BUCKET_MS;
  const buildId = material.buildId || ALLMANGA_BUILD_ID;
  const contentLane = material.contentLane || ALLMANGA_CONTENT_LANE_EPISODE;
  const payloadIv = `${material.epoch}:${buildId}:${material.queryHash}:${ts}:${contentLane}`;
  const payload = JSON.stringify({
    v: 1,
    ts,
    epoch: material.epoch,
    buildId,
    qh: material.queryHash,
    k: contentLane,
  });
  const iv = createHash("sha256").update(payloadIv).digest().subarray(0, 12);
  const key = Buffer.from(material.keyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, ciphertext, tag]).toString("base64");
}

type BootstrapResponse = {
  readonly epoch?: number;
  readonly partB?: string;
  readonly k?: string;
  readonly switchAt?: number;
};

export async function fetchAllMangaCryptoMaterial(
  context: ProviderRuntimeContext,
  ua: string,
  signal?: AbortSignal,
): Promise<AllMangaCryptoMaterial | null> {
  try {
    const buildId = ALLMANGA_BUILD_ID;
    const contentLane = ALLMANGA_CONTENT_LANE_EPISODE;

    for (const epoch of currentAllMangaEpochCandidates()) {
      const boot = buildAllMangaBootToken({
        buildId,
        epoch,
        keyGroup: ALLMANGA_KEY_GROUP,
        refererHost: "mkissa.to",
        contentLane,
      });
      const url = `${ALLMANGA_BOOTSTRAP_URL}?buildId=${encodeURIComponent(buildId)}&k=${encodeURIComponent(contentLane)}`;
      try {
        const response = await providerFetch(context, url, {
          signal: signal
            ? (() => {
                const timeout = AbortSignal.timeout(12_000);
                if (typeof AbortSignal.any === "function") {
                  return AbortSignal.any([signal, timeout]);
                }
                return signal.aborted ? signal : timeout;
              })()
            : AbortSignal.timeout(12_000),
          headers: {
            "User-Agent": ua,
            Referer: `${ALLMANGA_SITE_ORIGIN}/`,
            Origin: ALLMANGA_SITE_ORIGIN,
            "x-build-id": buildId,
            "x-aa-boot": boot,
          },
        });
        if (!response.ok) continue;
        const body = (await response.json()) as BootstrapResponse;
        if (
          !body.partB ||
          typeof body.epoch !== "number" ||
          !Number.isFinite(body.epoch) ||
          body.epoch <= 0
        ) {
          continue;
        }
        const key = deriveKeyFromPartB(body.partB, buildId);
        return {
          keyHex: key.toString("hex"),
          epoch: body.epoch,
          queryHash: ALLMANGA_QUERY_HASH,
          buildId,
          contentLane: body.k?.trim() || contentLane,
        };
      } catch {
        // try next epoch candidate
      }
    }
    return null;
  } catch {
    return null;
  }
}
