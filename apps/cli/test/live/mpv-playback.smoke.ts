/**
 * Opt-in mpv decode check: resolve one matrix fixture, then prove mpv decodes it.
 *
 * Usage — one provider per run, and only the four with fixtures here. The
 * anime providers keep their own search-based smokes, so naming them prints the
 * supported list instead:
 *   bun run test:live:mpv videasy
 *   bun run test:live:mpv rivestream
 *   bun run test:live:mpv vidlink
 *   bun run test:live:mpv youtube
 *
 * Isolated temporary XDG profile (never touches live config/data/cache),
 * headless mpv (`--vo=null --ao=null --frames=30`), 20s deadline. Prints one
 * redacted JSON line: no stream URLs, cookies, or /tmp paths.
 */
import type { TitleInfo } from "@/domain/types";

import {
  buildMpvPlaybackVerifyArgs,
  redactMpvArgsForLog,
  verifyStreamPlaysInMpv,
} from "./mpv-playback-verify";
import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const profile = createProviderSmokeProfile("mpv-playback");
const args = directSmokeArgs();
const providerId = (args[0] ?? "vidlink").toLowerCase();
const frames = Number(process.env.KUNAI_MPV_FRAMES ?? "30") || 30;

const FIXTURES: Record<
  string,
  { title: TitleInfo; mode: "series" | "anime" | "youtube"; season?: number; episode?: number }
> = {
  videasy: {
    title: { id: "299167", type: "series", name: "Dutton Ranch" },
    mode: "series",
    season: 1,
    episode: 1,
  },
  rivestream: {
    title: { id: "1396", type: "series", name: "Breaking Bad" },
    mode: "series",
    season: 1,
    episode: 1,
  },
  vidlink: {
    title: { id: "27205", type: "movie", name: "Inception" },
    mode: "series",
  },
  youtube: {
    title: {
      id: "youtube:jNQXAC9IVRw",
      type: "movie",
      name: "Me at the zoo",
      externalIds: { youtubeId: "jNQXAC9IVRw" },
    },
    mode: "youtube",
  },
};

const fixture = FIXTURES[providerId];
if (!fixture) {
  console.log(
    JSON.stringify({
      ok: false,
      provider: providerId,
      reason: `mpv-playback supports ${Object.keys(FIXTURES).join(",")} (anime search fixtures stay in their own smokes)`,
      ...providerSmokeProfilePayload(profile),
    }),
  );
  process.exit(1);
}

if (!Bun.which("mpv")) {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      provider: providerId,
      reason: "mpv missing on PATH",
      ...providerSmokeProfilePayload(profile),
    }),
  );
  process.exit(0);
}

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
if (!container.providerRegistry.get(providerId)) {
  console.log(
    JSON.stringify({
      ok: false,
      provider: providerId,
      reason: `missing_${providerId}`,
      ...providerSmokeProfilePayload(profile),
    }),
  );
  process.exit(1);
}

let resolveError: unknown = null;
const resolved = await resolveProviderSmokeStream({
  container,
  providerId,
  mode: fixture.mode,
  request: {
    title: fixture.title,
    ...(fixture.season && fixture.episode
      ? { episode: { season: fixture.season, episode: fixture.episode } }
      : {}),
    audioPreference: container.config.seriesLanguageProfile.audio,
    subtitlePreference: container.config.seriesLanguageProfile.subtitle,
  },
}).catch((error) => {
  resolveError = error;
  return { stream: null, resolveDurationMs: null };
});

const stream = resolved.stream;
const base = buildProviderSmokePayload({
  provider: providerId,
  title: fixture.title,
  season: fixture.season,
  episode: fixture.episode,
  stream,
  resolveDurationMs: resolved.resolveDurationMs,
});

if (!stream?.url) {
  console.log(
    JSON.stringify({
      ...base,
      ...(resolveError ? providerSmokeError(resolveError) : {}),
      mpv: { ok: false, reason: "nothing resolved to hand to mpv" },
      mpvArgs: [],
      ...providerSmokeProfilePayload(profile),
    }),
  );
  process.exit(1);
}

const mpvArgs = buildMpvPlaybackVerifyArgs({ url: stream.url, headers: stream.headers, frames });
const mpv = await verifyStreamPlaysInMpv({ url: stream.url, headers: stream.headers, frames });
// Never log credential material: Cookie / signature values stay in the spawned
// argv only. The report carries the redacted shape for review.
const redactedMpvArgs = redactMpvArgsForLog(mpvArgs);
const ok = base.ok && mpv.ok;
console.log(
  JSON.stringify({
    ...base,
    mpv,
    mpvArgs: redactedMpvArgs.slice(0, -2),
    mpvUrlHost: base.streamHost,
    ...providerSmokeProfilePayload(profile),
  }),
);
process.exit(ok ? 0 : 1);
