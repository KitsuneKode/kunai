import type { TitleInfo } from "@/domain/types";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";
import type { StartupPriority } from "@kunai/types";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

const profile = createProviderSmokeProfile("videasy");
const args = process.argv.slice(1);

const season = Number(args[0] ?? "1");
const episode = Number(args[1] ?? "2");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";
const startupPriority = resolveSmokeStartupPriority(process.env.KITSUNE_SMOKE_STARTUP_PRIORITY);

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("videasy");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_videasy" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: "127529",
  type: "series",
  name: "Bloodhounds",
};

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "videasy",
  mode: "series",
  request: {
    title,
    episode: { season, episode },
    audioPreference: container.config.seriesLanguageProfile.audio,
    subtitlePreference: container.config.seriesLanguageProfile.subtitle,
    startupPriority,
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

const payload = {
  ...buildProviderSmokePayload({
    provider: "videasy",
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
  selectedSourceId: stream?.providerResolveResult?.selectedStreamId ?? null,
  streamReachable: streamProbe ? isStreamReachableForResolve(streamProbe) : false,
  streamProbeStatus: streamProbe?.status ?? null,
  ...providerSmokeProfilePayload(profile),
  provider: "videasy",
  subtitleUrl: stream?.subtitle ?? null,
  subtitleSource: stream?.subtitleSource ?? null,
  subtitleEvidence: stream?.subtitleEvidence ?? null,
  cacheCleared: clearCache,
  startupPriority,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url || !streamProbe || !isStreamReachableForResolve(streamProbe)) {
  process.exit(1);
}

function resolveSmokeStartupPriority(value: string | undefined): StartupPriority {
  return value === "fast" || value === "balanced" || value === "quality-first" ? value : "balanced";
}
