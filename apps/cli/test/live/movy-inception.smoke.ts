/**
 * Live smoke for the Movy lane.
 *
 * Movy uses XOR-decrypted sources from api.wecollege.net.
 * This test verifies the seed fetch, lane decryption, and source resolution.
 */
import type { TitleInfo } from "@/domain/types";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

const profile = createProviderSmokeProfile("movy");
const args = process.argv.slice(1);

const season = Number(args[0] ?? "1");
const episode = Number(args[1] ?? "1");
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

const title: TitleInfo = {
  id: "27205",
  type: "movie",
  name: "Inception",
};

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
    audioPreference: container.config.movieLanguageProfile.audio,
    subtitlePreference: container.config.movieLanguageProfile.subtitle,
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
const streamReachable = streamProbe ? isStreamReachableForResolve(streamProbe) : null;

const payload = {
  ...buildProviderSmokePayload({
    provider: "movy",
    title,
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

if (!stream?.url || streamReachable === false) {
  process.exit(1);
}
