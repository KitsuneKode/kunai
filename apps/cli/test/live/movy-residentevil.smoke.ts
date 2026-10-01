/**
 * Live smoke for the Movy lane.
 *
 * TMDB-keyed multi-lane aggregator: each named lane wraps a different upstream
 * scraper, dead lanes return per-lane 500s and the cycle survives on the live
 * ones. The fixture is a movie (Resident Evil, TMDB 1423191 — the dossier's
 * verified case); pass a TMDB series id via env-free args only if the movie
 * shape is not what you want to exercise.
 *
 * bun test/live/movy-residentevil.smoke.ts [tmdbId] [series season episode]
 */
import type { TitleInfo } from "@/domain/types";
import { probeStreamReachability } from "@kunai/providers";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
  smokeStreamReachable,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("movy");
const args = directSmokeArgs();

const tmdbId = args[0] ?? "1423191";
const seasonArg = args[1];
const episodeArg = args[2];
const isSeries = seasonArg !== undefined && episodeArg !== undefined;
const season = isSeries ? Number(seasonArg) : undefined;
const episode = isSeries ? Number(episodeArg) : undefined;
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("movy");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_movy" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = isSeries
  ? { id: tmdbId, type: "series", name: "Movy series fixture" }
  : { id: tmdbId, type: "movie", name: "Resident Evil" };

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;

const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "movy",
  mode: "series",
  request: {
    title,
    ...(isSeries && season !== undefined && episode !== undefined
      ? { episode: { season, episode } }
      : {}),
    audioPreference: container.config.seriesLanguageProfile.audio,
    subtitlePreference: container.config.seriesLanguageProfile.subtitle,
  },
})
  .then((resolved) => {
    failureCodes = resolved.result.failures.map((failure) => failure.code);
    failureMessages = resolved.result.failures.map((failure) => failure.message);
    streamCandidates = resolved.result.streams.length;
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
const streamReachable = streamProbe ? smokeStreamReachable(streamProbe) : null;

const payload = {
  ...buildProviderSmokePayload({
    provider: "movy",
    title,
    season,
    episode,
    stream,
    resolveDurationMs,
  }),
  failureCodes,
  failureMessages,
  streamCandidates,
  streamProbe,
  streamReachable,
  ...(resolveError ? providerSmokeError(resolveError) : null),
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
