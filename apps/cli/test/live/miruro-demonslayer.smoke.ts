import type { TitleInfo } from "@/domain/types";
import { clearMiruroCachesForTest, probeStreamReachability } from "@kunai/providers";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
  smokeStreamReachable,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("miruro");
// bun path/to/smoke.ts [episode] [anilistId] [title...]
const args = directSmokeArgs();

const episode = Number(args[0] ?? "1159");
const titleId = args[1] ?? "21";
const titleName = args.slice(2).join(" ") || "One Piece";
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("miruro");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_miruro" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
  // The CLI cache store is not the only place a stale answer hides — the Miruro
  // module keeps its own episode/source caches. Clear those too, or a
  // "cache cleared" run still reads from them.
  clearMiruroCachesForTest();
}

const title: TitleInfo = {
  id: titleId.startsWith("anilist:") ? titleId : `anilist:${titleId}`,
  type: "series",
  name: titleName,
  isAnime: true,
  externalIds: { anilistId: titleId.replace(/^anilist:/, "") },
};

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
/**
 * The resolver no longer claims reachability it did not measure, so the smoke
 * owns the probe. `resolverAttestedReachable` is reported separately and is
 * never what this smoke passes on — actual reachability is.
 */
let resolverAttestedReachable: boolean | undefined;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "miruro",
  mode: "anime",
  request: {
    title,
    episode: { season: 1, episode },
    audioPreference: container.config.animeLanguageProfile.audio,
    subtitlePreference: container.config.animeLanguageProfile.subtitle,
  },
})
  .then((resolved) => {
    failureCodes = resolved.result.failures.map((failure) => failure.code);
    failureMessages = resolved.result.failures.map((failure) => failure.message);
    streamCandidates = resolved.result.streams.length;
    resolverAttestedReachable = resolved.result.streamReachabilityVerified;
    return resolved;
  })
  .catch((error) => {
    resolveError = error;
    return { stream: null, resolveDurationMs: null };
  });

const streamProbe = stream?.url
  ? await probeStreamReachability({
      url: stream.url,
      headers: stream.headers,
      timeoutMs: 5_000,
    })
  : null;
const streamReachable = smokeStreamReachable(streamProbe);

const payload = {
  ...buildProviderSmokePayload({
    provider: "miruro",
    title,
    season: 1,
    episode,
    stream,
    resolveDurationMs,
  }),
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  failureCodes,
  failureMessages,
  streamCandidates,
  streamProbe,
  streamReachable,
  resolverAttestedReachable,
  ...providerSmokeProfilePayload(profile),
  animeLang: container.config.animeLang,
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

// Pass on measured reachability, not on resolver attestation — a resolver that
// correctly declines to attest an unprobed stream must still be able to pass.
if (!stream?.url || streamReachable === false) {
  // Let stdout flush so the matrix parent can retain structured failure evidence.
  process.exitCode = 1;
}
