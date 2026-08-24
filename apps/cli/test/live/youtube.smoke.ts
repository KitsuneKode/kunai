import type { TitleInfo } from "@/domain/types";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";

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

const streamProbe = stream?.url
  ? await probeStreamReachability({
      url: stream.url,
      headers: stream.headers,
      timeoutMs: 5_000,
    })
  : null;
const streamReachable = streamProbe ? isStreamReachableForResolve(streamProbe) : null;

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
    streamProbe,
    streamReachable,
    error: resolveError instanceof Error ? resolveError.message : undefined,
    ...providerSmokeProfilePayload(profile),
  }),
);

// A resolved URL that does not serve bytes is the false green this probe
// exists to catch, so a *measured* failure fails the smoke. `null` means the
// probe never ran, which `payload.ok` already covers.
if (!payload.ok || streamReachable === false) {
  console.error(providerSmokeError(payload));
  process.exit(1);
}

// Substring matching would accept `youtube.com.evil.test`. Compare the parsed
// hostname against the exact apex plus its subdomains instead.
const rawStreamHost = payload.streamHost ?? "";
const streamHostname = rawStreamHost.includes("://")
  ? new URL(rawStreamHost).hostname
  : rawStreamHost;
const isYouTubeHost = streamHostname === "youtube.com" || streamHostname.endsWith(".youtube.com");

if (!isYouTubeHost) {
  console.error(JSON.stringify({ ok: false, reason: "expected_youtube_watch_host" }));
  process.exit(1);
}

process.exit(0);
