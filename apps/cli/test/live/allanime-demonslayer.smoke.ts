import { searchTitles } from "@/app/search-routing";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

const profile = createProviderSmokeProfile("allanime");

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const { searchRegistry, providerRegistry, config } = container;

const query = process.argv[2] ?? "Kimetsu no Yaiba";
const fixtureTitleId = process.argv[3] ?? "SJms742bSTrcyJZay";

const search = await searchTitles(query, {
  mode: "anime",
  providerId: config.animeProvider,
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
        provider: config.animeProvider,
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

const provider = providerRegistry.get(config.animeProvider);
if (!provider) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "provider",
        provider: config.animeProvider,
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
};

const episodes = provider.listEpisodes ? await provider.listEpisodes({ title }) : null;
let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream } = await resolveProviderSmokeStream({
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
    return { stream: null };
  });

const payload = {
  ...buildProviderSmokePayload({
    provider: provider.metadata.id,
    title,
    season: 1,
    episode: 1,
    stream,
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
  ...providerSmokeProfilePayload(profile),
  subtitleUrl: stream?.subtitle ?? null,
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
