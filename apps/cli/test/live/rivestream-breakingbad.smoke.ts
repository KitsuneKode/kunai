import type { TitleInfo } from "@/domain/types";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

const profile = createProviderSmokeProfile("rivestream");

const season = Number(process.argv[2] ?? "1");
const episode = Number(process.argv[3] ?? "1");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("rivestream");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_rivestream" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: "1396",
  type: "series",
  name: "Breaking Bad",
};

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "rivestream",
  mode: "series",
  request: {
    title,
    episode: { season, episode },
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
    provider: "rivestream",
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
