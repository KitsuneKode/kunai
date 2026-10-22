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
const searchQuery = args.slice(1).join(" ") || "bleach";
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("anidb");

if (!provider) {
  console.log(JSON.stringify({ ok: false, stage: "provider", reason: "missing_anidb" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

// Skip search test - use direct AniDB ID for resolve test
const title = {
  id: "anidb:3765",
  type: "series" as const,
  name: "Bleach",
  externalIds: {
    providerNativeIds: {
      anidb: "3765",
    },
  },
};

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
  ...(resolveError ? providerSmokeError(resolveError) : null),
  failureCodes,
  failureMessages,
  streamCandidates,
  ...providerSmokeProfilePayload(profile),
};

console.log(JSON.stringify(payload, null, 2));
process.exit(payload.ok ? 0 : 1);
