import type { TitleInfo } from "@/domain/types";
import { DEFAULT_YOUTUBE_EXTRACTOR_ARGS } from "@kunai/config";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";
import { parseYoutubePlayerClients, youtubeQualityHeight } from "@kunai/providers/youtube";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";

/** Stable public-domain style fixture: Me at the zoo (first YouTube upload). */
const YOUTUBE_FIXTURE_VIDEO_ID = "jNQXAC9IVRw";

/**
 * A second fixture, for the quality ladder only. "Me at the zoo" is a 2005 upload
 * that genuinely tops out at 240p, so it can never distinguish a healthy ladder
 * from a collapsed one. Blender's official CC-BY Big Buck Bunny carries the full
 * 360/480/720/1080/1440/2160 ladder and is about as durable as a YouTube upload gets.
 */
const YOUTUBE_QUALITY_FIXTURE_VIDEO_ID = "aqz-KE-bpKQ";

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

/**
 * The floor this probe defends, against the quality fixture only. A player client
 * whose GVS PO-token policy is unmet does not error -- yt-dlp *skips* those formats,
 * leaving only the muxed 360p itag. Resolve still succeeds and the URL is still
 * reachable, so every check this smoke used to run stayed green while playback
 * silently capped at 360p. Asserting the ladder is what turns that into a failure.
 */
const MIN_EXPECTED_HEIGHT = 1080;

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

const defaultPlayerClients = parseYoutubePlayerClients(DEFAULT_YOUTUBE_EXTRACTOR_ARGS);

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
    defaultPlayerClients,
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

const qualityTitle: TitleInfo = {
  id: `youtube:${YOUTUBE_QUALITY_FIXTURE_VIDEO_ID}`,
  type: "movie",
  name: "Big Buck Bunny 60fps 4K",
  externalIds: { youtubeId: YOUTUBE_QUALITY_FIXTURE_VIDEO_ID },
};

const qualityResolve = await resolveProviderSmokeStream({
  container,
  providerId: "youtube",
  mode: "youtube",
  request: {
    title: qualityTitle,
    audioPreference: container.config.youtubeLanguageProfile.audio,
    subtitlePreference: container.config.youtubeLanguageProfile.subtitle,
  },
}).catch(() => null);

const qualityLabels = (qualityResolve?.result.variants ?? [])
  .map((variant) => variant.qualityLabel)
  .filter((label): label is string => Boolean(label));
const ladderHeights = qualityLabels
  .map((label) => youtubeQualityHeight(label))
  .filter((height): height is number => typeof height === "number");
const maxLadderHeight = ladderHeights.length > 0 ? Math.max(...ladderHeights) : null;

console.log(
  JSON.stringify({
    ok: maxLadderHeight !== null && maxLadderHeight >= MIN_EXPECTED_HEIGHT,
    check: "quality-ladder",
    titleId: qualityTitle.id,
    qualityLabels,
    maxLadderHeight,
    minExpectedHeight: MIN_EXPECTED_HEIGHT,
  }),
);

// Both checks run before exiting. The ladder is the symptom a viewer actually
// sees and the client order is the mechanism behind it, so reporting only the
// first to fail hides half of a diagnosis that is cheap to give in full.
const qualityFailures: { readonly reason: string; readonly [key: string]: unknown }[] = [];

// `ytsearch:` runs YouTube's ordinary search, which excludes Shorts outright: a probe
// of `ytsearch12:cooking` returned twelve entries and not one carried a Shorts signal.
// A `type:short` query could therefore only filter itself down to nothing and then
// fall through to a backend that was never asked for Shorts either, so the feature
// reported "search failed" instead of returning Shorts.
const shortsSearch = provider.search
  ? await provider
      .search("cooking", {
        audioPreference: container.config.youtubeLanguageProfile.audio,
        subtitlePreference: container.config.youtubeLanguageProfile.subtitle,
        contentShape: "short",
      })
      .catch(() => null)
  : null;
const shortsShapes = [...new Set((shortsSearch ?? []).map((result) => result.contentShape))];

console.log(
  JSON.stringify({
    ok: (shortsSearch?.length ?? 0) > 0 && shortsShapes.every((shape) => shape === "short"),
    check: "type-short-search",
    resultCount: shortsSearch?.length ?? 0,
    shapes: shortsShapes,
  }),
);

if (!shortsSearch?.length) {
  qualityFailures.push({
    reason: "type_short_search_returned_nothing",
    hint: "The Shorts lane must use YouTube's own Shorts search filter; `ytsearch:` never returns Shorts.",
  });
} else if (shortsShapes.some((shape) => shape !== "short")) {
  qualityFailures.push({
    reason: "type_short_search_returned_non_shorts",
    shapes: shortsShapes,
  });
}

if (maxLadderHeight === null || maxLadderHeight < MIN_EXPECTED_HEIGHT) {
  qualityFailures.push({
    reason: "quality_ladder_below_expected_floor",
    maxLadderHeight,
    minExpectedHeight: MIN_EXPECTED_HEIGHT,
    qualityLabels,
    hint: "A ladder that stops at or below 360p means every requested player client had its formats skipped for a missing GVS PO token.",
  });
}

// Measured against real YouTube on 2026-08-27 with yt-dlp 2026.08.19 and no PO
// token: `visionos` returned 48 formats topping out at 2160p, while `web`,
// `mweb`, `tv_simply` and `android` each returned 5 formats capped at 360p, and
// `ios` failed extraction outright. The first lane is the one that has to work,
// because the later lanes are a playback fallback, not a quality one.
if (defaultPlayerClients[0] !== "visionos") {
  qualityFailures.push({
    reason: "expected_visionos_first_player_client",
    defaultPlayerClients,
  });
}

if (qualityFailures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures: qualityFailures }));
  process.exit(1);
}

process.exit(0);
