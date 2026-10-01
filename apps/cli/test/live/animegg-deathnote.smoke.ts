/**
 * Live smoke for the AnimeGG lane.
 *
 * Searches through the provider itself (the route users actually take), then
 * resolves an episode. Evidence is an mpv frame decode, not an HTTP probe:
 * AnimeGG's `vidcache` host answers `{"error":"Invalid request (bad hand
 * off)"}` with HTTP 500 to anything that is not its player — a probe reports a
 * false death on a stream mpv plays fine (documented in the dossier).
 *
 * bun test/live/animegg-deathnote.smoke.ts [episode] [search query...]
 */
import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  mpvDecodesStream,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("animegg");
const args = directSmokeArgs();

const episode = Number(args[0] ?? "5");
const searchQuery = args.slice(1).join(" ") || "Death Note";
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

if (!provider.search) {
  console.error(JSON.stringify({ ok: false, stage: "search", reason: "animegg_has_no_search" }));
  process.exit(1);
}

const searchResults = await provider.search(searchQuery, {
  audioPreference: container.config.animeLanguageProfile.audio,
  subtitlePreference: container.config.animeLanguageProfile.subtitle,
});

// `null` is transport failure, `[]` is catalog absence — do not conflate them.
if (searchResults === null) {
  console.error(
    JSON.stringify({
      ok: false,
      stage: "search",
      searchedProvider: "animegg",
      searchResults: 0,
      reason: `animegg search transport failed for "${searchQuery}" (provider unreachable)`,
    }),
  );
  process.exit(1);
}

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
      searchedProvider: "animegg",
      searchResults: 0,
      reason: `animegg search returned zero results for "${searchQuery}"`,
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
  providerId: "animegg",
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

// The only honest verdict for this provider: mpv writes a frame, or it does not.
const mpvDecodes = stream?.url
  ? await mpvDecodesStream({ url: stream.url, headers: stream.headers })
  : null;

const payload = {
  ...buildProviderSmokePayload({
    provider: "animegg",
    title,
    season: 1,
    episode,
    stream,
    resolveDurationMs,
  }),
  searchedProvider: "animegg",
  searchResults: searchResults.length,
  failureCodes,
  failureMessages,
  streamCandidates,
  mpvDecodes,
  ...(resolveError ? providerSmokeError(resolveError) : null),
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

// `mpvDecodes === false` is a measured non-play. `null` means no mpv on PATH —
// unverifiable but not condemned, matching the other smokes' probe semantics.
if (!stream?.url || mpvDecodes === false) {
  process.exitCode = 1;
}
