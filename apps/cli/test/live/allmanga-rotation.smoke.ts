/**
 * Detects an mkissa crypto rotation *before* users hit it.
 *
 * mkissa rotates `buildId` roughly monthly, and every rotation so far has moved
 * the derivation constants with it. Both failures degrade silently to bundled
 * material, so the first symptom users see is "AllAnime found nothing". This
 * smoke re-derives the profile from the live site and fails when it no longer
 * matches what `packages/providers/src/allmanga/crypto.ts` pins.
 *
 * Two independent checks, because they catch different halves of a rotation:
 *   1. Static — walk the SvelteKit bundle, decode the obfuscated string table,
 *      and read the buildId the live client actually sends.
 *   2. Live    — ask the bootstrap endpoint to accept a token built from the
 *      pinned profile. Only a 200 proves the whole profile still derives.
 *
 * Safe by default: without KUNAI_LIVE_ALLMANGA_ROTATION=1 this prints a skip
 * and makes no network request.
 *
 *   KUNAI_LIVE_ALLMANGA_ROTATION=1 bun run test:live:allmanga-rotation
 */
import {
  ALLMANGA_BOOTSTRAP_URL,
  ALLMANGA_CONTENT_LANE_EPISODE,
  ALLMANGA_CRYPTO_PROFILE,
  ALLMANGA_KEY_GROUP,
  ALLMANGA_SITE_ORIGIN,
  buildAllMangaBootToken,
  currentAllMangaEpochCandidates,
} from "@kunai/providers";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const SITE_HOST = new URL(ALLMANGA_SITE_ORIGIN).hostname;

if (process.env.KUNAI_LIVE_ALLMANGA_ROTATION !== "1") {
  console.log(
    JSON.stringify(
      {
        skipped: true,
        reason: "Set KUNAI_LIVE_ALLMANGA_ROTATION=1 to check mkissa for a crypto rotation",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const get = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Referer: `${ALLMANGA_SITE_ORIGIN}/` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.text();
};

/**
 * Read the buildId out of the obfuscated crypto chunk.
 *
 * The bundle hides its strings in one array that a self-invoking rotation
 * shifts by a fixed amount before use. Rather than re-implement that rotation
 * (it is itself obfuscated and changes shape between builds), we take the one
 * property it cannot hide: the buildId is the only element that survives as a
 * bare 2-4 digit numeric string once the epoch-looking values are excluded.
 */
function extractBuildIdCandidates(chunk: string): string[] {
  const candidates = new Set<string>();

  // The string table is the chunk's largest array of short string literals.
  // Scan every array literal rather than the first `const e=[`, because the
  // bundle contains several and their order is not stable between builds.
  for (const match of chunk.matchAll(/=\[(?="[^"]{0,8}",")/g)) {
    const open = match.index + 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < chunk.length; i += 1) {
      if (chunk[i] === "[") depth += 1;
      else if (chunk[i] === "]") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) continue;
    const literals = chunk.slice(open, end).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
    // A real string table is long; a short array is some unrelated literal.
    if (literals.length < 32) continue;
    for (const literal of literals) {
      let value: string;
      try {
        value = JSON.parse(literal) as string;
      } catch {
        continue;
      }
      // Upstream's obfuscator also parks call-count markers like "127" in the
      // table, so this is a candidate set, not a single answer. The bootstrap
      // check below is what actually decides.
      if (/^\d{2,4}$/.test(value)) candidates.add(value);
    }
  }
  return [...candidates];
}

const failures: string[] = [];
const notes: string[] = [];

// ---- 1. Static: what buildId does the live client ship? ----
let staticBuildIds: string[] = [];
try {
  const html = await get(`${ALLMANGA_SITE_ORIGIN}/`);
  const entry = html.match(/https:\/\/[^"']+\/entry\/app\.[A-Za-z0-9_-]+\.js/)?.[0];
  if (!entry) throw new Error("no app entry script in site HTML");
  const assetBase = entry.slice(0, entry.indexOf("/entry/"));
  const app = await get(entry);
  const chunkNames = [...new Set(app.match(/chunks\/[A-Za-z0-9_-]+\.js/g) ?? [])];

  for (const name of chunkNames) {
    const chunk = await get(`${assetBase}/${name}`);
    if (!chunk.includes("x-aa-boot")) continue;
    staticBuildIds = extractBuildIdCandidates(chunk);
    notes.push(`crypto chunk: ${name}`);
    break;
  }

  if (staticBuildIds.length === 0) {
    notes.push("could not read a buildId from the live bundle (obfuscation changed shape)");
  } else if (!staticBuildIds.includes(ALLMANGA_CRYPTO_PROFILE.buildId)) {
    failures.push(
      `live bundle ships buildId ${staticBuildIds.join("/")}, profile pins ${ALLMANGA_CRYPTO_PROFILE.buildId}`,
    );
  }
} catch (error) {
  notes.push(`static extraction failed: ${(error as Error).message}`);
}

// ---- 2. Live: does the pinned profile still derive an accepted token? ----
// This is the authoritative check. A 200 proves buildId, salt/frag constants,
// boot prefix, part order and separator are all still correct together.
let bootstrapStatus = 0;
let bootstrapBody = "";
for (const epoch of currentAllMangaEpochCandidates(Date.now())) {
  const boot = buildAllMangaBootToken({
    buildId: ALLMANGA_CRYPTO_PROFILE.buildId,
    epoch,
    keyGroup: ALLMANGA_KEY_GROUP,
    refererHost: SITE_HOST,
    contentLane: ALLMANGA_CONTENT_LANE_EPISODE,
  });
  const url = `${ALLMANGA_BOOTSTRAP_URL}?buildId=${encodeURIComponent(ALLMANGA_CRYPTO_PROFILE.buildId)}&k=${encodeURIComponent(ALLMANGA_CONTENT_LANE_EPISODE)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: `${ALLMANGA_SITE_ORIGIN}/`,
      Origin: ALLMANGA_SITE_ORIGIN,
      "x-build-id": ALLMANGA_CRYPTO_PROFILE.buildId,
      "x-aa-boot": boot,
    },
    signal: AbortSignal.timeout(20_000),
  });
  bootstrapStatus = response.status;
  bootstrapBody = await response.text();
  if (response.ok) break;
}

if (bootstrapStatus !== 200) {
  failures.push(
    bootstrapBody.includes("unknown_build_id")
      ? `bootstrap rejected build ${ALLMANGA_CRYPTO_PROFILE.buildId} as unknown — upstream rotated; re-extract the whole profile`
      : bootstrapBody.includes("invalid_boot_token")
        ? `bootstrap rejected our token for build ${ALLMANGA_CRYPTO_PROFILE.buildId} — derivation constants drifted; re-extract the whole profile`
        : `bootstrap returned ${bootstrapStatus}: ${bootstrapBody.slice(0, 160)}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      pinnedBuildId: ALLMANGA_CRYPTO_PROFILE.buildId,
      liveBundleBuildIds: staticBuildIds,
      bootstrapStatus,
      notes,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  console.error(
    "\nmkissa rotated. Re-extract every field of ALLMANGA_CRYPTO_PROFILE together —\n" +
      "buildId, saltMul/saltAdd, fragMul/fragAdd, bootPrefix, bootJoin, bootParts and\n" +
      "maskFragments — from the crypto chunk. Pinning the buildId alone does not work.\n",
  );
  process.exit(1);
}
