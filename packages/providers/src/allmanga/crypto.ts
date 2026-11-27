import { createCipheriv, createHash, createHmac } from "node:crypto";

import type { ProviderRuntimeContext } from "@kunai/types";

import { providerFetch } from "../runtime/fetch";
import { getProviderCryptoOverride, getProviderHotfixEntry } from "../shared/hotfix-runtime";
import { readJsonObjectBody } from "../shared/json-body";
import { isSafeManifestHttpsUrl } from "../shared/manifest-bundle";

/**
 * AllManga / mkissa client-crypto (post-2026-08 buildId scheme).
 *
 * Upstream left the ani-cli `72d7f72` "no buildId / scrape epoch+partB from HTML"
 * path — and as of ani-cli `a6ac602` (v5) there is no upstream AllAnime path at
 * all to check parity against. Live mkissa:
 * - ships a rotating `buildId` (`81` → `119` → `140` → `166` → `171` → `177`
 *   → `181` → `189` → `193`)
 *   plus four base64 mask fragments in the app chunk
 * - boots keys via `GET /client-crypto/v1/bootstrap?buildId=&k=` with
 *   `x-build-id` + HMAC `x-aa-boot`
 * - signs `aaReq` as AES-GCM over `{v,ts,epoch,buildId,qh,k}` with IV
 *   `SHA-256(epoch:buildId:qh:ts:k)[0:12]`
 * - rotates the epoch scale; build 193 uses 3650-day epochs (315360000000 ms),
 *   still with a 1-day grace
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
 * The build-177 profile (extracted 2026-10-13, verified by a live bootstrap
 * 200 + `tobeparsed` round-trip decrypt) adds three fields to upstream's
 * config object: `v:1`, `omitEmptyLane:false`, and `envXor:223`. `envXor` is
 * XORed into every mask-key byte only when upstream's browser-env probe
 * passes — our requests take the non-browser path, so the raw mask is
 * correct here (probing with the XOR applied returns `invalid_boot_token`).
 * They are documented but deliberately not carried into the profile object:
 * nothing on our request path consumes them, and a field nothing reads is a
 * lie waiting for the next extractor to copy it.
 *
 * The build-181 profile (extracted 2026-10-19 from
 * `chunks/Cs-j4hUW.js`, verified by a live bootstrap 200 + GraphQL episode
 * round-trip) keeps the same wire scheme and re-rolls `envXor` to `82`;
 * `v:1`/`omitEmptyLane:false` persist. The episode query template did not
 * change this rotation, so {@link ALLMANGA_QUERY_HASH} carried over — verify
 * that on the next rotation, do not assume it.
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
 * The episode persisted-query hash rotates with the app build — it changed
 * again for 177 and is re-hashed from the chunk's query template on every
 * rotation (see the dossier).
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
  /** Epoch length and near-boundary grace from live bootstrap JSON. */
  readonly epochMs: number;
  readonly epochGraceMs: number;
};

/**
 * Live profile, extracted from `cdn.mkissa.net/all/mk/_app/immutable/chunks/CkL4bHwD.js`
 * on 2026-11-27 and confirmed live on epoch 5 (HTTP 200). The bootstrap response
 * reported `epochMs: 315360000000`, `graceMs: 86400000`, and the partB pinned
 * into the fallback material below.
 */
export const ALLMANGA_CRYPTO_PROFILE: AllMangaCryptoProfile = {
  buildId: "193",
  saltMul: 205,
  saltAdd: 41,
  fragMul: 215,
  fragAdd: 80,
  bootPrefix: "ueQcEF8Ty:",
  bootJoin: ":",
  bootParts: ["lane", "buildId", "host", "group", "epoch"],
  maskFragments: ["hI3RQE5scOQ=", "aZlAcGKA4p8=", "BpZqf9YyKxs=", "iXO5zhmOKgI="],
  epochMs: 315_360_000_000,
  epochGraceMs: 86_400_000,
};

export const ALLMANGA_BUILD_ID = ALLMANGA_CRYPTO_PROFILE.buildId;

/**
 * sha256 of the episode persisted-query document, which rotates with the app
 * build. It is a true persisted query: the text is never sent, so a stale hash
 * comes back as `PersistedQueryNotFound` and every resolve returns no streams.
 * Recover it by re-hashing the document in the crypto chunk (the builder's
 * name rotates with the build — `iK`/`Dj`/`…` — find the template containing
 * `episode(` and expand its `Oi`/`Kt`/`Zr()` fragments; see the dossier).
 */
export const ALLMANGA_QUERY_HASH =
  "670bbf38d0868f446e2346c1e956ca2c40c416e733ca248fd54e04f1c8b99145";
/** Episode GraphQL lane (`Lf` → `k7`). */
export const ALLMANGA_CONTENT_LANE_EPISODE = "k7";
export const ALLMANGA_KEY_GROUP = "mkissa";
export const ALLMANGA_BOOTSTRAP_URL = "https://api.mkissa.net/client-crypto/v1/bootstrap";
export const ALLMANGA_SITE_ORIGIN = "https://mkissa.to";

/** Epoch length (ms) and near-boundary grace from live bootstrap JSON. */
export const ALLMANGA_EPOCH_MS = ALLMANGA_CRYPTO_PROFILE.epochMs;
export const ALLMANGA_EPOCH_GRACE_MS = ALLMANGA_CRYPTO_PROFILE.epochGraceMs;
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
 * Last-known-good material when bootstrap fails (epoch 5, build 193),
 * captured from a live bootstrap on 2026-11-27. It must be derived under the
 * same profile as {@link ALLMANGA_CRYPTO_PROFILE}: a key left over from an
 * older build is not a degraded fallback, it is a guaranteed decrypt failure.
 * `allmanga.test.ts` pins that relationship.
 *
 * The epoch is a long-lived bucket on build 193, but it still goes stale on
 * the next rotation. It
 * exists to survive a brief bootstrap outage, not to replace one — a resolve
 * that quietly runs on a fallback two epochs old looks exactly like a dead
 * provider.
 */
export const ALLMANGA_KEY_HEX = "0b15a379d221e17ec2a93b49c8e9d424382e549138820adb938c42626fc18f7c";
export const ALLMANGA_EPOCH = 5;

export const BUNDLED_ALLMANGA_CRYPTO: AllMangaCryptoMaterial = {
  keyHex: ALLMANGA_KEY_HEX,
  epoch: ALLMANGA_EPOCH,
  queryHash: ALLMANGA_QUERY_HASH,
  buildId: ALLMANGA_BUILD_ID,
  contentLane: ALLMANGA_CONTENT_LANE_EPISODE,
};

const VALID_BOOT_PARTS = new Set<AllMangaBootPart>(["group", "host", "lane", "buildId", "epoch"]);

/**
 * Returns the active Tier-1 hotfix AllManga crypto profile when a complete,
 * valid rotation bundle is installed; falls back atomically to the bundled
 * profile on any missing or malformed field so partial rotations never apply.
 */
export function getEffectiveAllMangaCryptoProfile(): AllMangaCryptoProfile {
  const overrides = getProviderHotfixEntry("allanime")?.cryptoOverrides;
  if (!overrides?.buildId) return ALLMANGA_CRYPTO_PROFILE;
  return parseAllMangaCryptoProfileOverride(overrides) ?? ALLMANGA_CRYPTO_PROFILE;
}

/**
 * Refuse, at install time, an `allanime` override that names a rotation
 * (`buildId`) but would fall back to the bundled profile at runtime. Applied
 * silently, it looks exactly like a stale pin: the operator thinks the
 * rotation shipped and every user stays on the old constants.
 */
export function describeAllMangaCryptoOverrideProblem(
  overrides: Readonly<Record<string, string>> | undefined,
): string | null {
  if (!overrides?.buildId) return null;
  return parseAllMangaCryptoProfileOverride(overrides)
    ? null
    : "AllManga cryptoOverrides names a buildId but the rotation profile is incomplete or malformed (saltMul, saltAdd, fragMul, fragAdd, bootPrefix, bootJoin, 5 bootParts, 4 maskFragments, epochMs, epochGraceMs)";
}

/** `Number("")` is 0, so a blank manifest field would read as a real constant. */
function overrideInteger(value: string | undefined): number {
  return value === undefined || value.trim() === "" ? Number.NaN : Number(value);
}

function parseAllMangaCryptoProfileOverride(
  overrides: Readonly<Record<string, string>>,
): AllMangaCryptoProfile | null {
  if (!overrides.buildId) return null;

  const saltMul = overrideInteger(overrides.saltMul);
  const saltAdd = overrideInteger(overrides.saltAdd);
  const fragMul = overrideInteger(overrides.fragMul);
  const fragAdd = overrideInteger(overrides.fragAdd);
  const bootPrefix = overrides.bootPrefix;
  const bootJoin = overrides.bootJoin;
  const bootPartsRaw = overrides.bootParts?.split(",").map((p) => p.trim()) ?? [];
  const maskFragments = overrides.maskFragments?.split(",").map((f) => f.trim()) ?? [];
  const epochMs = overrideInteger(overrides.epochMs);
  const epochGraceMs = overrideInteger(overrides.epochGraceMs);

  if (
    !Number.isInteger(saltMul) ||
    !Number.isInteger(saltAdd) ||
    !Number.isInteger(fragMul) ||
    !Number.isInteger(fragAdd) ||
    !bootPrefix ||
    !bootJoin ||
    bootPartsRaw.length !== 5 ||
    !bootPartsRaw.every((p): p is AllMangaBootPart =>
      VALID_BOOT_PARTS.has(p as AllMangaBootPart),
    ) ||
    maskFragments.length !== 4 ||
    maskFragments.some((f) => Buffer.from(f, "base64").length !== 8) ||
    !Number.isInteger(epochMs) ||
    epochMs <= 0 ||
    !Number.isInteger(epochGraceMs) ||
    epochGraceMs < 0
  ) {
    return null;
  }

  return {
    buildId: overrides.buildId,
    saltMul,
    saltAdd,
    fragMul,
    fragAdd,
    bootPrefix,
    bootJoin,
    bootParts: bootPartsRaw,
    maskFragments,
    epochMs,
    epochGraceMs,
  };
}

export function getEffectiveAllMangaQueryHash(): string {
  return getProviderCryptoOverride("allanime", "queryHash", ALLMANGA_QUERY_HASH);
}

export function getEffectiveAllMangaBootstrapUrl(): string {
  const override = getProviderCryptoOverride("allanime", "bootstrapUrl", ALLMANGA_BOOTSTRAP_URL);
  return isSafeManifestHttpsUrl(override) ? override : ALLMANGA_BOOTSTRAP_URL;
}

export function getEffectiveAllMangaContentLane(): string {
  return getProviderCryptoOverride("allanime", "contentLane", ALLMANGA_CONTENT_LANE_EPISODE);
}

export function hashBuildId(buildId: string): Buffer {
  const profile = getEffectiveAllMangaCryptoProfile();
  const text = buildId || "";
  const out = Buffer.alloc(32);
  for (let index = 0; index < 32; index += 1) {
    out[index] =
      (text.charCodeAt(index % Math.max(text.length, 1)) || 0) ^
      ((index * profile.saltMul + profile.saltAdd) & 255);
  }
  return out;
}

/** Port of mkissa `ev(buildId)` — 32-byte mask key material. */
export function deriveMaskKey(buildId?: string, fragments?: readonly string[]): Buffer {
  const profile = getEffectiveAllMangaCryptoProfile();
  const activeBuildId = buildId ?? profile.buildId;
  const activeFragments = fragments ?? profile.maskFragments;
  const hashed = hashBuildId(activeBuildId);
  const out = Buffer.alloc(32);
  for (let fragmentIndex = 0; fragmentIndex < 4; fragmentIndex += 1) {
    const fragment = Buffer.from(activeFragments[fragmentIndex] ?? "", "base64");
    const offset = fragmentIndex * 8;
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      out[offset + byteIndex] =
        (fragment[byteIndex] ?? 0) ^
        (hashed[offset + byteIndex] ?? 0) ^
        (((fragmentIndex * profile.fragMul + byteIndex * profile.fragAdd) & 255) >>> 0);
    }
  }
  return out;
}

export function deriveKeyFromPartB(partB: string, buildId?: string): Buffer {
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

export function getEffectiveAllMangaEpochMs(): number {
  return getEffectiveAllMangaCryptoProfile().epochMs;
}

export function getEffectiveAllMangaEpochGraceMs(): number {
  return getEffectiveAllMangaCryptoProfile().epochGraceMs;
}

export function currentAllMangaEpochCandidates(nowMs: number = Date.now()): readonly number[] {
  const epochMs = getEffectiveAllMangaEpochMs();
  const current = Math.floor(nowMs / epochMs);
  const nearBoundary =
    nowMs - current * epochMs < getEffectiveAllMangaEpochGraceMs() && current > 0;
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
  const profile = getEffectiveAllMangaCryptoProfile();
  const buildId = options.buildId ?? profile.buildId;
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
  const inner = Buffer.from(hmacSha256Hex(mask, `${profile.bootPrefix}${buildId}`), "hex");
  const payload = profile.bootParts.map((part) => values[part]).join(profile.bootJoin);
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
    const profile = getEffectiveAllMangaCryptoProfile();
    const buildId = profile.buildId;
    const contentLane = getEffectiveAllMangaContentLane();
    const bootstrapUrl = getEffectiveAllMangaBootstrapUrl();
    const queryHash = getEffectiveAllMangaQueryHash();
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
      const url = `${bootstrapUrl}?buildId=${encodeURIComponent(buildId)}&k=${encodeURIComponent(contentLane)}`;
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
          queryHash,
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
