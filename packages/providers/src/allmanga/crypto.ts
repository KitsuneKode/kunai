import { createCipheriv, createHash, createHmac } from "node:crypto";

import type { ProviderRuntimeContext } from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { readJsonObjectBody } from "../shared/json-body";

/**
 * AllManga / mkissa client-crypto (post-2026-08 buildId scheme).
 *
 * Upstream left the ani-cli `72d7f72` "no buildId / scrape epoch+partB from HTML"
 * path — and as of ani-cli `a6ac602` (v5) there is no upstream AllAnime path at
 * all to check parity against. Live mkissa:
 * - ships a rotating `buildId` (`81` → `119` → `140` → `166` → `171`) plus four
 *   base64 mask fragments in the app chunk
 * - boots keys via `GET /client-crypto/v1/bootstrap?buildId=&k=` with
 *   `x-build-id` + HMAC `x-aa-boot`
 * - signs `aaReq` as AES-GCM over `{v,ts,epoch,buildId,qh,k}` with IV
 *   `SHA-256(epoch:buildId:qh:ts:k)[0:12]`
 * - rotates the epoch scale: 7-day epochs (604800000 ms), 1-day grace
 *
 * **A rotation moves every constant here at once**, so update them together and
 * assume none carried over. The 2026-09-08 rotation (140 → 166) changed the
 * build id, all four mask fragments, every derivation constant, the boot
 * prefix, the join character, the boot payload *field order*, and the episode
 * persisted-query hash. A partial update fails exactly like no update.
 *
 * 2026-09-16 rotation (166 → 171) changed *every* derivation constant again.
 * That is the shape of an mkissa rotation: the buildId is the visible part,
 * but pinning it alone does not work. A boot token built from build 171 with
 * the build-166 constants is rejected `invalid_boot_token` just as surely as
 * build 166 is rejected `unknown_build_id` — verified against the live
 * endpoint.
 *
 * Everything that rotates therefore lives in one {@link ALLMANGA_CRYPTO_PROFILE}
 * object, so the next rotation is a single replacement that cannot be applied
 * halfway. `apps/cli/test/live/allmanga-rotation.smoke.ts` re-extracts the live
 * values and fails when they drift from this profile.
 *
 * The recovery procedure — which failure means which half is stale, and how to
 * read the constants back out of the obfuscated chunk — is in
 * [the AllManga dossier](../../../../.docs/provider-dossiers/allmanga.md).
 *
 * The episode persisted-query hash is unchanged by these rotations.
 */

/** A part of the `x-aa-boot` second-HMAC message, in upstream's order. */
export type AllMangaBootPart = "group" | "host" | "lane" | "buildId" | "epoch";

/**
 * Everything mkissa rotates together, extracted from the obfuscated crypto
 * chunk's config object. Replace this whole object on a rotation — never a
 * single field.
 */
export type AllMangaCryptoProfile = {
  readonly buildId: string;
  /** `hashBuildId` mixes `(index * saltMul + saltAdd)`. */
  readonly saltMul: number;
  readonly saltAdd: number;
  /** `deriveMaskKey` mixes `(fragmentIndex * fragMul + byteIndex * fragAdd)`. */
  readonly fragMul: number;
  readonly fragAdd: number;
  /** First HMAC message is `bootPrefix + buildId`. */
  readonly bootPrefix: string;
  /** Second HMAC message is `bootParts` joined by `bootJoin`. */
  readonly bootJoin: string;
  readonly bootParts: readonly AllMangaBootPart[];
  /** Four base64 8-byte mask fragments. */
  readonly maskFragments: readonly string[];
};

/**
 * Live profile, extracted from `cdn.mkissa.net/all/mk/_app/immutable/chunks/`
 * on 2026-09-16 and confirmed by a successful bootstrap (HTTP 200, epoch 2958).
 */
export const ALLMANGA_CRYPTO_PROFILE: AllMangaCryptoProfile = {
  buildId: "171",
  saltMul: 48,
  saltAdd: 35,
  fragMul: 241,
  fragAdd: 122,
  bootPrefix: "OFs9AwZvw:",
  bootJoin: "/",
  bootParts: ["lane", "epoch", "host", "group", "buildId"],
  maskFragments: ["l6wLXtFBb/4=", "AxhuiL0mzuE=", "lhrBc5MPXWI=", "26xOf/HD8sY="],
};

export const ALLMANGA_BUILD_ID = ALLMANGA_CRYPTO_PROFILE.buildId;

/**
 * sha256 of the episode persisted-query document, which rotates with the app
 * build. It is a true persisted query: the text is never sent, so a stale hash
 * comes back as `PersistedQueryNotFound` and every resolve returns no streams.
 * Recover it by re-hashing the document in the crypto chunk (`iK`, with its
 * `Mi` / `Kt` / `en()` fragments expanded) — see the AllManga dossier.
 */
export const ALLMANGA_QUERY_HASH =
  "1c836a5028e04275c6bc618aa4d1f0ea2290a73bc056ba6a8b93fe72ef42fd04";
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
export const ALLMANGA_MASK_FRAGMENTS = ALLMANGA_CRYPTO_PROFILE.maskFragments;

/** How long derived crypto material stays trusted before a lazy refetch. */
export const ALLMANGA_CRYPTO_MATERIAL_TTL_MS = 6 * 60 * 60 * 1000;

export type AllMangaCryptoMaterial = {
  readonly keyHex: string;
  readonly epoch: number;
  readonly queryHash: string;
  readonly buildId: string;
  readonly contentLane: string;
};

/**
 * Last-known-good material when bootstrap fails (epoch 2958, build 171),
 * captured from a live bootstrap on 2026-09-16. It must be derived under the
 * same profile as {@link ALLMANGA_CRYPTO_PROFILE}: a key left over from an
 * older build is not a degraded fallback, it is a guaranteed decrypt failure.
 * `allmanga.test.ts` pins that relationship.
 *
 * The epoch is a 7-day bucket, so this fallback goes stale on its own. It
 * exists to survive a brief bootstrap outage, not to replace one — a resolve
 * that quietly runs on a fallback two epochs old looks exactly like a dead
 * provider.
 */
export const ALLMANGA_KEY_HEX = "29f65d91ec588d32262f1905ae4a7d1cfe3f5ab61e77604ca24912c1772ce2e6";
export const ALLMANGA_EPOCH = 2958;

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
      (text.charCodeAt(index % Math.max(text.length, 1)) || 0) ^
      ((index * ALLMANGA_CRYPTO_PROFILE.saltMul + ALLMANGA_CRYPTO_PROFILE.saltAdd) & 255);
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
        (((fragmentIndex * ALLMANGA_CRYPTO_PROFILE.fragMul +
          byteIndex * ALLMANGA_CRYPTO_PROFILE.fragAdd) &
          255) >>>
          0);
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
 *
 * First HMAC message is `{bootPrefix}{buildId}`; the second joins
 * {@link AllMangaCryptoProfile.bootParts} with `bootJoin`. Both the order and
 * the separator rotate with the buildId, so both come from the profile.
 */
export function buildAllMangaBootToken(options: {
  readonly buildId?: string;
  readonly epoch: number;
  readonly keyGroup?: string;
  readonly refererHost?: string;
  readonly contentLane?: string;
}): string {
  const buildId = options.buildId ?? ALLMANGA_BUILD_ID;
  const values: Record<AllMangaBootPart, string> = {
    group: options.keyGroup ?? ALLMANGA_KEY_GROUP,
    // Signed without the `www.` prefix; the site sends the bare host.
    host: String(options.refererHost ?? "mkissa.to")
      .toLowerCase()
      .replace(/^www\./, ""),
    lane: options.contentLane?.trim() ?? "",
    buildId,
    epoch: String(options.epoch),
  };
  const mask = deriveMaskKey(buildId);
  const inner = Buffer.from(
    hmacSha256Hex(mask, `${ALLMANGA_CRYPTO_PROFILE.bootPrefix}${buildId}`),
    "hex",
  );
  const payload = ALLMANGA_CRYPTO_PROFILE.bootParts
    .map((part) => values[part])
    .join(ALLMANGA_CRYPTO_PROFILE.bootJoin);
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

/**
 * Why a bootstrap was refused. The two rotation failures need different
 * responses and used to be indistinguishable, so a rotation looked exactly
 * like a network blip and degraded silently to bundled material:
 *
 * - `build-rotated` — upstream no longer knows our `buildId`. The profile is
 *   stale wholesale; re-extract it from the live chunk.
 * - `token-rejected` — upstream knows the `buildId` but not our token, so the
 *   derivation constants drifted out from under a still-valid build.
 */
export type AllMangaRotationSignal = "build-rotated" | "token-rejected" | "unavailable";

export function classifyAllMangaBootstrapFailure(
  status: number,
  body: string,
): AllMangaRotationSignal {
  if (body.includes("unknown_build_id")) return "build-rotated";
  if (body.includes("invalid_boot_token")) return "token-rejected";

  // Cloudflare and generic HTML challenge pages are WAF/network blocks, not mkissa rotations.
  const lower = body.toLowerCase();
  if (
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification")
  ) {
    return "unavailable";
  }

  // Fall back to status alone when the body is not the documented JSON.
  if (status === 404) return "build-rotated";
  if (status === 403) return "token-rejected";
  return "unavailable";
}

/**
 * Last rotation signal observed by {@link fetchAllMangaCryptoMaterial}.
 * `api-client.ts` reads this to say *why* it fell back to bundled material
 * instead of reporting an unexplained crypto miss.
 */
let lastAllMangaRotationSignal: AllMangaRotationSignal | null = null;

export function getLastAllMangaRotationSignal(): AllMangaRotationSignal | null {
  return lastAllMangaRotationSignal;
}

/** Test seam: clear the module-level signal between cases. */
export function resetAllMangaRotationSignalForTest(): void {
  lastAllMangaRotationSignal = null;
}

export async function fetchAllMangaCryptoMaterial(
  context: ProviderRuntimeContext,
  ua: string,
  signal?: AbortSignal,
): Promise<AllMangaCryptoMaterial | null> {
  let lastRotationSignal: AllMangaRotationSignal | null = null;
  try {
    const buildId = ALLMANGA_BUILD_ID;
    const contentLane = ALLMANGA_CONTENT_LANE_EPISODE;
    const contextNowMs = Date.parse(context.now());
    const nowMs = Number.isFinite(contextNowMs) ? contextNowMs : Date.now();

    for (const epoch of currentAllMangaEpochCandidates(nowMs)) {
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
        if (!response.ok) {
          lastRotationSignal = classifyAllMangaBootstrapFailure(
            response.status,
            await response.text().catch(() => ""),
          );
          continue;
        }
        const body = await readJsonObjectBody<BootstrapResponse>(response);
        if (
          !body?.partB ||
          typeof body.epoch !== "number" ||
          !Number.isFinite(body.epoch) ||
          body.epoch <= 0
        ) {
          continue;
        }
        const key = deriveKeyFromPartB(body.partB, buildId);
        lastAllMangaRotationSignal = null;
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
    lastAllMangaRotationSignal = lastRotationSignal ?? "unavailable";
    return null;
  } catch {
    lastAllMangaRotationSignal = lastRotationSignal ?? "unavailable";
    return null;
  }
}
