/**
 * Live smoke for the VidRock lane.
 *
 * VidRock's upstream lanes die and rotate often enough that a stale success
 * claim is the real risk: this smoke exists so the matrix row reports measured
 * reachability rather than inheriting health from a cached resolve. It covers
 * a movie by default; pass season/episode to exercise the series path.
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

const profile = createProviderSmokeProfile("vidrock");
// bun path/to/smoke.ts [season] [episode]  — omit both for the movie lane.
const args = directSmokeArgs();

const season = args[0] === undefined ? undefined : Number(args[0]);
const episode = args[1] === undefined ? undefined : Number(args[1]);
const isSeries = season !== undefined && episode !== undefined;
const isCacheClearRequested = () => process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("vidrock");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_vidrock" }));
  process.exit(1);
}

if (isCacheClearRequested()) {
  await container.cacheStore.clear();
}

const title: TitleInfo = isSeries
  ? { id: "1396", type: "series", name: "Breaking Bad" }
  : { id: "27205", type: "movie", name: "Inception" };

let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;

const outcome = await resolveProviderSmokeStream({
  container,
  providerId: "vidrock",
  mode: "series",
  request: {
    title,
    episode: isSeries ? { season, episode } : undefined,
    audioPreference: container.config.seriesLanguageProfile.audio,
    subtitlePreference: container.config.seriesLanguageProfile.subtitle,
  },
})
  .then((resolved) => {
    failureCodes = resolved.result.failures.map((failure) => failure.code);
    failureMessages = resolved.result.failures.map((failure) => failure.message);
    streamCandidates = resolved.result.streams.length;
    return { resolved };
  })
  .catch((error) => ({ error }));

const stream = "resolved" in outcome ? outcome.resolved.stream : null;
const resolveDurationMs = "resolved" in outcome ? outcome.resolved.resolveDurationMs : null;

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
    provider: "vidrock",
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
  ...providerSmokeProfilePayload(profile),
  cacheCleared: isCacheClearRequested(),
};

if ("error" in outcome) {
  Object.assign(payload, providerSmokeError(outcome.error));
}

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
