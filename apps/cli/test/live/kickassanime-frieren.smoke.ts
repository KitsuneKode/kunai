/**
 * Live smoke for the KickAssAnime lane.
 *
 * Searches through the provider itself, then resolves an episode in the
 * requested audio mode. Evidence is an mpv frame decode: ffmpeg fails on the
 * VidStreaming master where mpv succeeds, so no reachability probe over these
 * URLs is a verdict (documented in the dossier — do not re-add one).
 *
 * bun test/live/kickassanime-frieren.smoke.ts [episode] [audio] [query...]
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

const profile = createProviderSmokeProfile("kickassanime");
const args = directSmokeArgs();

const episode = Number(args[0] ?? "5");
const audioArg = args[1];
const searchQuery = args.slice(2).join(" ") || "Frieren";
const clearCache = () => process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("kickassanime");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_kickassanime" }));
  process.exit(1);
}

if (clearCache()) {
  await container.cacheStore.clear();
}

if (!provider.search) {
  console.error(
    JSON.stringify({ ok: false, stage: "search", reason: "kickassanime_has_no_search" }),
  );
  process.exit(1);
}

const audio = audioArg ?? container.config.animeLanguageProfile.audio;

const searchResults = await provider.search(searchQuery, {
  audioPreference: audio,
  subtitlePreference: container.config.animeLanguageProfile.subtitle,
});

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
  searchResults.find((result) =>
    normalizeTitle(result.title).startsWith(normalizeTitle(searchQuery)),
  ) ?? searchResults[0];

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

// oxlint-disable-next-line anti-slop/no-known-value-widening -- the slot holds whatever the resolve rejects with; unknown IS the contract here
let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
let failureMessages: readonly string[] = [];
let streamCandidates = 0;
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "kickassanime",
  mode: "anime",
  request: {
    title,
    episode: { season: 1, episode },
    audioPreference: audio,
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

const mpvDecodes = stream?.url
  ? await mpvDecodesStream({ url: stream.url, headers: stream.headers })
  : null;

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
  audio,
  failureCodes,
  failureMessages,
  streamCandidates,
  mpvDecodes,
  ...(resolveError ? providerSmokeError(resolveError) : null),
  ...providerSmokeProfilePayload(profile),
  cacheCleared: clearCache(),
};

console.log(JSON.stringify(payload, null, 2));

if (!stream?.url || mpvDecodes === false) {
  process.exitCode = 1;
}
