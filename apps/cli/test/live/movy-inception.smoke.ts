/**
 * Live smoke for the Movy lane.
 *
 * Movy resolves through a multi-lane aggregator (api.wecollege.net seeds into
 * named source lanes) and had no live coverage at all until the matrix needed
 * one row per registered provider. It covers a movie by default; pass
 * season/episode to exercise the series path.
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
// bun path/to/smoke.ts [season] [episode]  — omit both for the movie lane.
const args = directSmokeArgs();

const season = args[0] === undefined ? undefined : Number(args[0]);
const episode = args[1] === undefined ? undefined : Number(args[1]);
const isSeries = season !== undefined && episode !== undefined;
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
  ? { id: "1396", type: "series", name: "Breaking Bad" }
  : { id: "27205", type: "movie", name: "Inception" };

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
    ...(isSeries ? { episode: { season, episode } } : {}),
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
