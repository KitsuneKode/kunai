/**
 * Is AllManga's pinned crypto still the crypto upstream is running?
 *
 * mkissa rotates its client crypto roughly monthly and every constant moves at
 * once. Between rotations the provider does not fail loudly: bootstrap failure
 * falls back to `BUNDLED_ALLMANGA_CRYPTO`, the episode query returns nothing
 * decodable, and every resolve reports zero streams — which reads as "this
 * anime has no sources" rather than "our constants expired".
 *
 * This asks the question directly, in one request, and reads the answer's own
 * taxonomy so the report says *which half* is stale:
 *
 *   200                            -> pinned constants still valid
 *   404 unknown_build_id           -> ALLMANGA_BUILD_ID rotated out
 *   403 invalid_boot_token         -> build id current, derivation constants rotated
 *   400 missing_build_id / ..lane  -> a dropped query param, not upstream drift
 *   Cloudflare HTML instead of JSON-> missing Referer/Origin
 *
 * Recovery procedure: .docs/provider-dossiers/allmanga.md
 * Touches no profile or database: this is crypto plus one HTTP request.
 */
import {
  ALLMANGA_BOOTSTRAP_URL,
  ALLMANGA_BUILD_ID,
  ALLMANGA_CONTENT_LANE_EPISODE,
  ALLMANGA_EPOCH,
  ALLMANGA_KEY_GROUP,
  ALLMANGA_SITE_ORIGIN,
  buildAllMangaBootToken,
  currentAllMangaEpochCandidates,
} from "@kunai/providers/allmanga/crypto";

import { allMangaCryptoRemedy, diagnoseAllMangaBootstrap } from "./allmanga-crypto-freshness";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Near an epoch boundary this returns `[previous, current]`, so the last entry
// is the live one. Taking `[0]` there compares the pinned material against the
// epoch that just ended and inverts the verdict.
const epochCandidates = currentAllMangaEpochCandidates(Date.now());
const epoch = epochCandidates.at(-1) ?? ALLMANGA_EPOCH;
const boot = buildAllMangaBootToken({
  epoch,
  keyGroup: ALLMANGA_KEY_GROUP,
  refererHost: "mkissa.to",
  contentLane: ALLMANGA_CONTENT_LANE_EPISODE,
});

let status = 0;
let body = "";
try {
  const response = await fetch(
    `${ALLMANGA_BOOTSTRAP_URL}?buildId=${encodeURIComponent(ALLMANGA_BUILD_ID)}&k=${encodeURIComponent(ALLMANGA_CONTENT_LANE_EPISODE)}`,
    {
      headers: {
        "User-Agent": UA,
        Referer: `${ALLMANGA_SITE_ORIGIN}/`,
        Origin: ALLMANGA_SITE_ORIGIN,
        "x-build-id": ALLMANGA_BUILD_ID,
        "x-aa-boot": boot,
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  status = response.status;
  body = (await response.text()).slice(0, 400);
} catch (error) {
  body = error instanceof Error ? error.message : String(error);
}

const diagnosis = diagnoseAllMangaBootstrap(status, body);

/**
 * The bundled fallback carries its own expiry: the epoch is a 7-day bucket, so
 * material more than one epoch behind is stale even when bootstrap answers.
 * A resolve quietly running on a fallback two epochs old looks exactly like a
 * dead provider.
 */
const epochsBehind = epoch - ALLMANGA_EPOCH;

const payload = {
  ok: diagnosis === "current" && epochsBehind <= 1,
  provider: "allanime",
  check: "crypto-freshness",
  diagnosis,
  status,
  pinnedBuildId: ALLMANGA_BUILD_ID,
  pinnedEpoch: ALLMANGA_EPOCH,
  liveEpoch: epoch,
  epochsBehind,
  // No partB, boot token, or key material in the report.
  detail:
    diagnosis === "current"
      ? undefined
      : body.replace(/https?:\/\/[^\s"']+/gi, "https://REDACTED").slice(0, 200),
  remedy: allMangaCryptoRemedy(diagnosis, epochsBehind),
};

console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);
