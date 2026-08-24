/**
 * Live smoke for the VidLink lane.
 *
 * VidLink shipped with no live smoke, no release-signoff route, and no
 * dedicated tests, which is how a total outage — every resolve discarded at the
 * reachability gate because the CDN rate-limits CLI probes — stayed invisible.
 * It covers a movie by default; pass season/episode to exercise the series path.
 */
import type { TitleInfo } from "@/domain/types";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("vidlink");
// bun path/to/smoke.ts [season] [episode]  — omit both for the movie lane.
const args = directSmokeArgs();

const season = args[0] === undefined ? undefined : Number(args[0]);
const episode = args[1] === undefined ? undefined : Number(args[1]);
const isSeries = season !== undefined && episode !== undefined;
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("vidlink");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_vidlink" }));
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
  providerId: "vidlink",
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

const payload = {
  ...buildProviderSmokePayload({
    provider: "vidlink",
    title,
    season,
    episode,
    stream,
    resolveDurationMs,
  }),
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  failureCodes,
  failureMessages,
  streamCandidates,
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
