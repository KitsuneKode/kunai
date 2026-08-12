import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("anidb");
// bun path/to/smoke.ts [episode] [search query...]
const args = directSmokeArgs();

const episode = Number(args[0] ?? "1");
const searchQuery = args.slice(1).join(" ") || "Onigiri";
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("anidb");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_anidb" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

// Search through the default provider itself. A hard-coded native id would let
// this smoke pass while AniDB search — the route users actually take — is dead.
if (!provider.search) {
  console.error(JSON.stringify({ ok: false, stage: "search", reason: "anidb_has_no_search" }));
  process.exit(1);
}

const searchResults =
  (await provider.search(searchQuery, {
    audioPreference: container.config.animeLanguageProfile.audio,
    subtitlePreference: container.config.animeLanguageProfile.subtitle,
  })) ?? [];

const normalizeTitle = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const selected =
  searchResults.find((result) => normalizeTitle(result.title) === normalizeTitle(searchQuery)) ??
  searchResults[0];

if (!selected) {
  console.error(
    JSON.stringify({
      ok: false,
      stage: "search",
      searchedProvider: "anidb",
      searchResults: 0,
      reason: `anidb search returned zero results for "${searchQuery}"`,
    }),
  );
  process.exit(1);
}

const title = titleInfoFromSearchResult(selected, selected.title);

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "anidb",
  mode: "anime",
  request: {
    title,
    episode: { season: 1, episode },
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

const payload = {
  ...buildProviderSmokePayload({
    provider: "anidb",
    title,
    season: 1,
    episode,
    stream,
    resolveDurationMs,
  }),
  ...(resolveError ? providerSmokeError(resolveError) : {}),
  searchedProvider: "anidb",
  searchResults: searchResults.length,
  failureCodes,
  failureMessages,
  streamCandidates,
  ...providerSmokeProfilePayload(profile),
};

console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);
