/**
 * Live smoke for the KickAssAnime lane.
 *
 * KickAssAnime is provider-native (no AniList dependency), so the smoke goes
 * through the provider's own search — the route a fallback resolve takes —
 * rather than a remembered slug. It covers Naruto S01E01 sub by default;
 * pass an episode number and a search query to exercise other titles.
 */
import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
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

const profile = createProviderSmokeProfile("kickassanime");
// bun path/to/smoke.ts [episode] [search query...]
const args = directSmokeArgs();

const episode = Number(args[0] ?? "1");
const searchQuery = args.slice(1).join(" ") || "Naruto";
const isCacheClearRequested = () => process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("kickassanime");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_kickassanime" }));
  process.exit(1);
}

if (isCacheClearRequested()) {
  await container.cacheStore.clear();
}

// Search through the provider itself: a remembered slug would let this pass
// while the name-matching route users actually take is dead.
if (!provider.search) {
  console.error(
    JSON.stringify({ ok: false, stage: "search", reason: "kickassanime_has_no_search" }),
  );
  process.exit(1);
}

const searchResults = await provider.search(searchQuery, {
  audioPreference: container.config.animeLanguageProfile.audio,
  subtitlePreference: container.config.animeLanguageProfile.subtitle,
});

// `null` is the transport-failure channel — an unreachable upstream, not an
// answer. Folding it into `[]` files an outage as catalog drift.
if (searchResults === null) {
  console.error(
    JSON.stringify({
      ok: false,
      stage: "search",
      searchedProvider: "kickassanime",
      searchResults: 0,
      reason: `kickassanime search transport failed for "${searchQuery}" (provider unreachable)`,
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
      searchedProvider: "kickassanime",
      searchResults: 0,
      reason: `kickassanime search returned zero results for "${searchQuery}"`,
    }),
  );
  process.exit(1);
}

const title = titleInfoFromSearchResult(selected, selected.title);

const outcome = await resolveProviderSmokeStream({
  container,
  providerId: "kickassanime",
  mode: "anime",
  request: {
    title,
    episode: { season: 1, episode },
    audioPreference: container.config.animeLanguageProfile.audio,
    subtitlePreference: container.config.animeLanguageProfile.subtitle,
  },
})
  .then((resolved) => ({ resolved }))
  .catch((error) => ({ error }));

const { stream, result, resolveDurationMs } =
  "resolved" in outcome
    ? outcome.resolved
    : { stream: null, result: null, resolveDurationMs: null };

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
    provider: "kickassanime",
    title,
    season: 1,
    episode,
    stream,
    resolveDurationMs,
  }),
  searchedProvider: "kickassanime",
  searchResults: searchResults.length,
  failureCodes: result?.failures.map((failure) => failure.code) ?? [],
  failureMessages: result?.failures.map((failure) => failure.message) ?? [],
  streamCandidates: result?.streams.length ?? 0,
  streamProbe,
  streamReachable,
  ...providerSmokeProfilePayload(profile),
  cacheCleared: isCacheClearRequested(),
};

if ("error" in outcome) {
  Object.assign(payload, providerSmokeError(outcome.error));
}

console.log(JSON.stringify(payload, null, 2));

// Only a measured refusal fails the smoke; an inconclusive probe stays
// neutral and leaves the resolution check to decide.
if (!stream?.url || streamReachable === false) {
  process.exitCode = 1;
}
