import { searchTitles } from "@/services/search/SearchRoutingService";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("allanime");
const args = directSmokeArgs();
const TARGET_PROVIDER = "allanime";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const { searchRegistry, providerRegistry, config } = container;

const query = args[0] ?? "Kimetsu no Yaiba";
const fixtureTitleId = args[1] ?? "SJms742bSTrcyJZay";

const search = await searchTitles(query, {
  mode: "anime",
  providerId: TARGET_PROVIDER,
  animeLanguageProfile: config.animeLanguageProfile,
  searchRegistry,
  providerRegistry,
}).catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "search",
        query,
        provider: TARGET_PROVIDER,
        ...providerSmokeProfilePayload(profile),
        ...providerSmokeError(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

const selected =
  search.results.find((result) => result.id === fixtureTitleId) ??
  search.results.find((result) => result.type === "series" && (result.episodeCount ?? 0) > 1) ??
  search.results.find((result) => result.type === "series") ??
  search.results[0];

if (!selected) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "search",
        query,
        reason: "no_results",
        ...providerSmokeProfilePayload(profile),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const provider = providerRegistry.get(TARGET_PROVIDER);
if (!provider) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "provider",
        provider: TARGET_PROVIDER,
        reason: "missing_provider",
        ...providerSmokeProfilePayload(profile),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const title = {
  id: selected.id,
  type: selected.type,
  name: selected.title,
  year: selected.year,
  overview: selected.overview,
  posterUrl: selected.posterPath ?? undefined,
  episodeCount: selected.episodeCount,
  isAnime: true,
};

const episodes = provider.listEpisodes ? await provider.listEpisodes({ title }) : null;
let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: provider.metadata.id,
  mode: "anime",
  request: {
    title,
    episode: { season: 1, episode: 1 },
    audioPreference: config.animeLanguageProfile.audio,
    subtitlePreference: config.animeLanguageProfile.subtitle,
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
    provider: provider.metadata.id,
    title,
    season: 1,
    episode: 1,
    stream,
    resolveDurationMs,
  }),
  query,
  fixtureTitleId,
  sourceName: search.sourceName,
  episodeCount: title.episodeCount ?? null,
  episodeOptions: episodes?.length ?? 0,
  firstEpisodes: episodes?.slice(0, 3).map((episode) => episode.label) ?? [],
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  failureCodes,
  failureMessages,
  streamCandidates,
  streamProbe,
  streamReachable,
  ...providerSmokeProfilePayload(profile),
  subtitleUrl: stream?.subtitle ?? null,
};

console.log(JSON.stringify(payload, null, 2));

// A resolved URL that does not serve bytes is the false green this probe
// exists to catch, so a *measured* failure fails the smoke. `null` means the
// probe never ran (nothing resolved), which the line above already covers --
// only `false` is evidence of an unplayable stream.
if (!stream?.url || streamReachable === false) {
  process.exit(1);
}
