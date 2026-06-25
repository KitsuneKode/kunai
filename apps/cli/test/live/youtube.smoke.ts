import type { TitleInfo } from "@/domain/types";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

/** Stable public-domain style fixture: Me at the zoo (first YouTube upload). */
const YOUTUBE_FIXTURE_VIDEO_ID = "jNQXAC9IVRw";

const profile = createProviderSmokeProfile("youtube");
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";

if (!Bun.which("yt-dlp")) {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      provider: "youtube",
      providerId: "youtube",
      title: "Me at the zoo",
      titleId: `youtube:${YOUTUBE_FIXTURE_VIDEO_ID}`,
      type: "movie",
      reason: "yt-dlp missing on PATH",
      ...providerSmokeProfilePayload(profile),
    }),
  );
  process.exit(0);
}

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("youtube");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_youtube" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const title: TitleInfo = {
  id: `youtube:${YOUTUBE_FIXTURE_VIDEO_ID}`,
  type: "movie",
  name: "Me at the zoo",
  externalIds: { youtubeId: YOUTUBE_FIXTURE_VIDEO_ID },
};

let resolveError: unknown = null;
let failureCodes: readonly string[] = [];
const { stream, resolveDurationMs } = await resolveProviderSmokeStream({
  container,
  providerId: "youtube",
  mode: "youtube",
  request: {
    title,
    audioPreference: container.config.youtubeLanguageProfile.audio,
    subtitlePreference: container.config.youtubeLanguageProfile.subtitle,
  },
})
  .then((resolved) => {
    failureCodes = resolved.result.failures.map((failure) => failure.code);
    return resolved;
  })
  .catch((error) => {
    resolveError = error;
    return { stream: null, resolveDurationMs: null };
  });

const payload = buildProviderSmokePayload({
  provider: "youtube",
  title,
  stream,
  resolveDurationMs,
});

console.log(
  JSON.stringify({
    ...payload,
    skipped: false,
    failureCodes,
    error: resolveError instanceof Error ? resolveError.message : undefined,
    ...providerSmokeProfilePayload(profile),
  }),
);

if (!payload.ok) {
  console.error(providerSmokeError(payload));
  process.exit(1);
}

if (!payload.streamHost?.includes("youtube.com")) {
  console.error(JSON.stringify({ ok: false, reason: "expected_youtube_watch_host" }));
  process.exit(1);
}

process.exit(0);
