import { searchTitles } from "@/services/search/SearchRoutingService";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

const relayBaseUrl = process.env.KUNAI_RELAY_BASE_URL?.trim();
if (!relayBaseUrl) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: "KUNAI_RELAY_BASE_URL is unset",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const profile = createProviderSmokeProfile("allanime");
const args = process.argv.slice(1);
const query = args[0] ?? "Kimetsu no Yaiba";
const fixtureTitleId = args[1] ?? "SJms742bSTrcyJZay";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
await container.config.update({
  animeProvider: "allanime",
  providerRelay: {
    ...container.config.providerRelay,
    baseUrl: relayBaseUrl,
    token: process.env.KUNAI_RELAY_TOKEN?.trim() || container.config.providerRelay.token,
    fallbackToDirect: false,
    providers: {
      ...container.config.providerRelay.providers,
      allanime: { enabled: true },
    },
  },
});

const { searchRegistry, providerRegistry, config } = container;
const search = await searchTitles(query, {
  mode: "anime",
  providerId: "allanime",
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
        provider: "allanime",
        relayBaseUrl,
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
        relayBaseUrl,
        reason: "no_results",
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

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "allanime",
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

const payload = {
  ...buildProviderSmokePayload({
    provider: "allanime",
    title,
    season: 1,
    episode: 1,
    stream,
    resolveDurationMs,
  }),
  query,
  fixtureTitleId,
  relayBaseUrl,
  sourceName: search.sourceName,
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  failureCodes,
  failureMessages,
  streamCandidates,
  ...providerSmokeProfilePayload(profile),
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url) {
  process.exit(1);
}
