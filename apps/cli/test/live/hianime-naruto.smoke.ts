import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import { clearHianimeCachesForTest, probeStreamReachability } from "@kunai/providers";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
  smokeStreamReachable,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("hianime");
// bun test/live/hianime-naruto.smoke.ts [episode] [search query...]
const args = directSmokeArgs();

const episode = Number(args[0] ?? "1");
const searchQuery = args.slice(1).join(" ") || "Naruto";
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("hianime");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_hianime" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
  // The CLI cache store is not the only place a stale answer hides — the
  // HiAnime module keeps its own episode catalog cache. Clear that too.
  clearHianimeCachesForTest();
}

// Search through the provider itself. A hard-coded native id would let this
// smoke pass while HiAnime search — the route users actually take — is dead.
if (!provider.search) {
  console.error(JSON.stringify({ ok: false, stage: "search", reason: "hianime_has_no_search" }));
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
      searchedProvider: "hianime",
      searchResults: 0,
      reason: `hianime search returned zero results for "${searchQuery}"`,
    }),
  );
  process.exit(1);
}

const title = titleInfoFromSearchResult(selected, selected.title);

async function resolveLeg(audioPreference: string) {
  let resolveError: unknown = null;
  const leg = await resolveProviderSmokeStream({
    container,
    providerId: "hianime",
    mode: "anime",
    request: {
      title,
      episode: { season: 1, episode },
      audioPreference,
      subtitlePreference: container.config.animeLanguageProfile.subtitle,
    },
  }).catch((error) => {
    resolveError = error;
    return { stream: null, result: null, resolveDurationMs: null };
  });
  const probe = leg.stream?.url
    ? await probeStreamReachability({
        url: leg.stream.url,
        headers: leg.stream.headers,
        timeoutMs: 5_000,
      })
    : null;
  return { ...leg, resolveError, probe, reachable: smokeStreamReachable(probe) };
}

// Sub and dub are separate embeds upstream: one leg each proves the switch
// the Tracks panel offers (re-resolve with the other source id).
const sub = await resolveLeg(container.config.animeLanguageProfile.audio);
const dub = await resolveLeg("en");

const payload = {
  ...buildProviderSmokePayload({
    provider: "hianime",
    title,
    season: 1,
    episode,
    stream: sub.stream,
    resolveDurationMs: sub.resolveDurationMs,
  }),
  searchedProvider: "hianime",
  searchResults: searchResults.length,
  failureCodes: sub.result?.failures.map((failure) => failure.code) ?? [],
  failureMessages: sub.result?.failures.map((failure) => failure.message) ?? [],
  streamCandidates: sub.result?.streams.length ?? 0,
  streamProbe: sub.probe,
  streamReachable: sub.reachable,
  // Structured resolve errors win over the empty fallbacks above: when the
  // resolve rejected, sub.result is null and the fallbacks would otherwise
  // blank the error's own failure codes and trace summary.
  ...(sub.resolveError ? providerSmokeError(sub.resolveError) : {}),
  dub: {
    streamResolved: Boolean(dub.stream?.url),
    quality:
      dub.result?.streams.find((stream) => stream.id === dub.result?.selectedStreamId)
        ?.qualityLabel ?? null,
    audioLanguages: dub.stream?.audioLanguages ?? [],
    subtitleTracks: dub.stream?.subtitleList?.length ?? 0,
    resolveDurationMs: dub.resolveDurationMs,
    failureCodes: dub.result?.failures.map((failure) => failure.code) ?? [],
    probe: dub.probe,
    reachable: dub.reachable,
    ...(dub.resolveError ? providerSmokeError(dub.resolveError) : {}),
  },
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

// Pass on measured reachability, not on resolve alone: only a refused probe
// (`false`) fails the smoke — an inconclusive probe (`null`) stays neutral.
if (!sub.stream?.url || sub.reachable === false || !dub.stream?.url || dub.reachable === false) {
  // Let stdout flush so the matrix parent can retain structured failure evidence.
  process.exitCode = 1;
}
