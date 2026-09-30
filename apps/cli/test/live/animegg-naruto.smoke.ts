/**
 * Live smoke for the AnimeGG lane.
 *
 * AnimeGG's stream URLs are `/play/<id>/video.mp4?for=<token>` hand-offs that
 * 302 to a vidcache host answering HTTP 500 "bad hand off" to anything that is
 * not a real player — a fetch probe included. Reachability evidence therefore
 * comes from mpv decoding a frame, not from the probe: the probe is still
 * reported for transparency, but `streamReachable` is the mpv verdict. On a
 * machine without mpv the row reports `streamReachable: null` and the resolve
 * alone decides the exit code.
 */
import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import { probeStreamReachability } from "@kunai/providers";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  mpvDecodesStream,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
  smokeStreamReachable,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("animegg");
// bun path/to/smoke.ts [episode] [search query...]
const args = directSmokeArgs();

const episode = Number(args[0] ?? "1");
const searchQuery = args.slice(1).join(" ") || "Naruto";
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
const resolved = await resolveProviderSmokeStream({
  container,
  providerId: "animegg",
  mode: "anime",
  request: {
    title,
    episode: { season: 1, episode },
    audioPreference: container.config.animeLanguageProfile.audio,
    subtitlePreference: container.config.animeLanguageProfile.subtitle,
  },
}).catch((error) => {
  resolveError = error;
  return { stream: null, result: null, resolveDurationMs: null };
});

const { stream, result, resolveDurationMs } = resolved;

// Reported for transparency only: AnimeGG's CDN refusing a fetch is expected,
// so the probe verdict never feeds `streamReachable`.
const streamProbe = stream?.url
  ? await probeStreamReachability({
      url: stream.url,
      headers: stream.headers,
      timeoutMs: 5_000,
    })
  : null;
const probeVerdict = streamProbe ? smokeStreamReachable(streamProbe) : null;

const mpvDecoded = stream?.url
  ? await mpvDecodesStream({ url: stream.url, headers: stream.headers, timeoutMs: 30_000 })
  : null;

// mpv is the only reachability evidence this CDN honors. When mpv is absent
// (null) nothing is claimed — `null` stays neutral rather than converting a
// refused-by-design probe into a provider verdict.
const streamReachable = mpvDecoded;

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
  failureCodes: result?.failures.map((failure) => failure.code) ?? [],
  failureMessages: result?.failures.map((failure) => failure.message) ?? [],
  streamCandidates: result?.streams.length ?? 0,
  streamProbe,
  probeVerdict,
  mpvDecoded,
  streamReachable,
  ...(resolveError ? providerSmokeError(resolveError) : null),
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache,
};

console.log(JSON.stringify(payload, null, 2));

// Fails on no resolve, or on measured playback failure — mpv gave up on the
// stream. A missing mpv (null) leaves the verdict to the resolve.
if (!stream?.url || mpvDecoded === false) {
  process.exitCode = 1;
}
