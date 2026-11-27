/**
 * Shared live smoke for the 2026-11 provider batch. The aggregate
 * `test:live:providers` contract requires one script per production provider;
 * keeping the probe in one file avoids three copies of the same orchestration.
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

const providerId = process.argv[2] ?? "";
const config = {
  vidbolt: {
    mode: "series" as const,
    title: { id: "550", type: "movie" as const, name: "Fight Club" },
  },
  anilight: {
    mode: "anime" as const,
    title: {
      id: "anilist:21",
      type: "series" as const,
      name: "One Piece",
      externalIds: { anilistId: "21" },
    },
  },
  anidap: {
    mode: "anime" as const,
    title: {
      id: "anilist:21",
      type: "series" as const,
      name: "One Piece",
      externalIds: { anilistId: "21" },
    },
  },
}[providerId];

if (!config) {
  console.error(
    JSON.stringify({ ok: false, stage: "argv", reason: "expected vidbolt|anilight|anidap" }),
  );
  process.exit(1);
}

const profile = createProviderSmokeProfile(providerId);
const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const title: TitleInfo = config.title;
let resolveFailure: ReturnType<typeof providerSmokeError> | undefined;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const languageProfile =
  config.mode === "anime"
    ? container.config.animeLanguageProfile
    : container.config.movieLanguageProfile;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId,
  mode: config.mode,
  request: {
    title,
    episode: { season: 1, episode: 1 },
    audioPreference: languageProfile.audio,
    subtitlePreference: languageProfile.subtitle,
    qualityPreference: languageProfile.quality,
  },
})
  .then((resolved) => {
    failureCodes = resolved.result.failures.map((failure) => failure.code);
    failureMessages = resolved.result.failures.map((failure) => failure.message);
    streamCandidates = resolved.result.streams.length;
    return resolved;
  })
  .catch((error) => {
    resolveFailure = providerSmokeError(error);
    return { stream: null, resolveDurationMs: null };
  });

const streamProbe = stream?.url
  ? await probeStreamReachability({ url: stream.url, headers: stream.headers, timeoutMs: 5_000 })
  : null;
const streamReachable = smokeStreamReachable(streamProbe);
const payload = {
  ...buildProviderSmokePayload({
    provider: providerId,
    title,
    season: 1,
    episode: 1,
    stream,
    resolveDurationMs,
  }),
  ...resolveFailure,
  failureCodes: resolveFailure?.failureCodes ?? failureCodes,
  failureMessages: resolveFailure?.failureMessages ?? failureMessages,
  streamCandidates: resolveFailure?.streamCandidates ?? streamCandidates,
  streamProbe,
  streamReachable,
  ...providerSmokeProfilePayload(profile),
};
console.log(JSON.stringify(payload, null, 2));
if (!stream?.url || streamReachable === false) process.exit(1);
