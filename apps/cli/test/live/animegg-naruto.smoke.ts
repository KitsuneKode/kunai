/**
 * Live smoke for the AnimeGG lane.
 *
 * AnimeGG uses direct MP4 URLs with episode-page Referer.
 * CDN may return 500 to probes but play in mpv - this is a player handoff.
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

const profile = createProviderSmokeProfile("animegg");
const args = process.argv.slice(1);

const season = Number(args[0] ?? "1");
const episode = Number(args[1] ?? "1");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("animegg");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_animegg" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: "animegg:naruto",
  type: "series",
  name: "Naruto",
};

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "animegg",
  mode: "anime",
  request: {
    title,
    episode: { season, episode },
    audioPreference: container.config.animeLanguageProfile.audio,
    subtitlePreference: container.config.animeLanguageProfile.subtitle,
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

// AnimeGG CDN may return 500 to probes but play in mpv, so we don't
// fail the smoke on a probe failure - we just report it.
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
    provider: "animegg",
    title,
    season,
    episode,
    stream,
    resolveDurationMs,
  }),
  ...(resolveError ? providerSmokeError(resolveError) : null),
  failureCodes,
  failureMessages,
  streamCandidates,
  streamProbe,
  streamReachable,
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

// AnimeGG may have probe failures but still play, so we only fail
// if resolution itself failed (no stream URL at all).
if (!stream?.url) {
  process.exit(1);
}
