/**
 * Live production-provider capability audit.
 *
 * Unlike the focused smokes, this measures the same fixture matrix across every
 * bundled provider in a lane: provider search when the contract exposes it,
 * episode listing, resolve inventory, an independent reachability probe, and
 * one PNG-frame decode proof per provider. It is opt-in live tooling: run it
 * intentionally, keep reruns sparse, and never treat one network flap as a dead
 * upstream.
 *
 *   bun test/live/provider-capability-audit.ts
 *   bun test/live/provider-capability-audit.ts videasy hianime
 *
 * Environment:
 *   KUNAI_AUDIT_ARTIFACT=/path/report.json  write the redacted JSON report
 *   KUNAI_AUDIT_FRAMES_DIR=/path/frames     preserve decode-proof PNGs
 *   KUNAI_AUDIT_DECODE=0                    resolve/probe only
 *
 * The profile is an isolated temporary HOME/XDG/APPDATA root created before the
 * container import. Stream URLs, cookies, tokens and home paths are redacted;
 * decode frames are the only artifacts preserved by default.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import { titleInfoFromSearchResult } from "@/app/bootstrap/title-info";
import type { SearchResult, StreamInfo, TitleInfo } from "@/domain/types";
import { decodePng } from "@/image/decode";
import {
  guardedYtdlRawOptions,
  normalizeStreamHttpHeaders,
} from "@/infra/player/mpv-stream-http-headers";
import { materializeDeferredMediaForPlayback } from "@/services/playback/deferred-media-materializer";
import { summarizeProviderTraceEvents } from "@kunai/core";
import { isHlsPlaylistUrl, probeStreamReachability } from "@kunai/providers";
import { isJsonString } from "@kunai/types";
import type { ProviderResolveResult, StreamCandidate } from "@kunai/types";

import {
  createProviderSmokeProfile,
  providerSmokeError,
  resolveProviderSmokeStream,
  smokeStreamReachable,
} from "./provider-smoke";
import { directSmokeArgs } from "./smoke-argv";

const MOVIE_PROVIDER_IDS = [
  "vidlink",
  "movy",
  "rivestream",
  "vidrock",
  "videasy",
  "vidbolt",
] as const;
const ANIME_PROVIDER_IDS = [
  "hianime",
  "kickassanime",
  "animegg",
  "miruro",
  "allanime",
  "anilight",
  "anidap",
] as const;
const YOUTUBE_PROVIDER_IDS = ["youtube"] as const;
const ALL_PROVIDER_IDS = [
  ...MOVIE_PROVIDER_IDS,
  ...ANIME_PROVIDER_IDS,
  ...YOUTUBE_PROVIDER_IDS,
] as const;

type MovieProviderId = (typeof MOVIE_PROVIDER_IDS)[number];
type AnimeProviderId = (typeof ANIME_PROVIDER_IDS)[number];
type ProviderId = (typeof ALL_PROVIDER_IDS)[number];

type MovieFixture = {
  readonly key: string;
  readonly kind: "movie";
  readonly title: TitleInfo;
};

type SeriesFixture = {
  readonly key: string;
  readonly kind: "series";
  readonly title: TitleInfo;
  readonly season: number;
  readonly episode: number;
};

type AnimeFixture = {
  readonly key: string;
  readonly query: string;
  readonly episode: number;
  readonly expectation: "long-running" | "recent";
};

const MOVIE_FIXTURES: readonly MovieFixture[] = [
  {
    key: "inception",
    kind: "movie",
    title: { id: "27205", type: "movie", name: "Inception" },
  },
  {
    key: "fight-club",
    kind: "movie",
    title: { id: "550", type: "movie", name: "Fight Club" },
  },
];

const SERIES_FIXTURES: readonly SeriesFixture[] = [
  {
    key: "breaking-bad-s01e01",
    kind: "series",
    title: { id: "1396", type: "series", name: "Breaking Bad" },
    season: 1,
    episode: 1,
  },
  {
    key: "dutton-ranch-s01e01",
    kind: "series",
    title: { id: "299167", type: "series", name: "Dutton Ranch" },
    season: 1,
    episode: 1,
  },
];

const ANIME_FIXTURES: readonly AnimeFixture[] = [
  {
    key: "one-piece-e1",
    query: "One Piece",
    episode: 1,
    expectation: "long-running",
  },
  {
    key: "dandadan-e1",
    query: "Dandadan",
    episode: 1,
    expectation: "recent",
  },
];

const YOUTUBE_FIXTURE = {
  key: "me-at-the-zoo",
  query: "Me at the zoo",
  expectedId: "jNQXAC9IVRw",
} as const;

type ProviderContainer = Awaited<ReturnType<typeof import("@/container").createContainer>>;

type SearchAudit = {
  readonly support: "provider-search" | "not-in-provider-contract";
  readonly status?: "ok" | "empty" | "transport-error" | "error" | "no-verified-match";
  readonly durationMs?: number;
  readonly resultCount?: number;
  readonly selectedTitle?: string;
  readonly selectedId?: string;
  readonly selectedYear?: string;
  readonly expectedIdFound?: boolean;
  readonly error?: string;
};

type EpisodeListAudit = {
  readonly support: "episode-list" | "not-in-provider-contract";
  readonly status?: "ok" | "empty" | "transport-error" | "error";
  readonly durationMs?: number;
  readonly count?: number;
  readonly firstLabels?: readonly string[];
  readonly error?: string;
};

type StreamSummary = {
  readonly id: string;
  readonly host: string | null;
  readonly protocol: string;
  readonly container?: string;
  readonly serverName?: string;
  readonly qualityLabel?: string;
  readonly qualityRank?: number;
  readonly dynamicRange?: string;
  readonly audioLanguages: readonly string[];
  readonly presentation?: string;
  readonly hardSubLanguage?: string;
  readonly subtitleDelivery?: string;
  readonly subtitleLanguages: readonly string[];
  readonly flavorArchetype?: string;
  readonly flavorLabel?: string;
  readonly requiresYtdl?: boolean;
  readonly deferred: boolean;
  readonly headerKeys: readonly string[];
  readonly metadataKeys: readonly string[];
  readonly metadataScalars?: readonly MetadataScalar[];
};

type MetadataScalar = {
  readonly key: string;
  readonly value: string;
};

type ResolveAudit = {
  readonly ok: boolean;
  readonly status: "resolved" | "exhausted" | "error";
  readonly resolveDurationMs: number | null;
  readonly failureCodes: readonly string[];
  readonly failureMessages: readonly string[];
  readonly error?: string;
  readonly streamCount: number;
  readonly sourceCount: number;
  readonly variantCount: number;
  readonly subtitleCount: number;
  readonly subtitleLanguages: readonly string[];
  readonly audioLanguages: readonly string[];
  readonly qualities: readonly string[];
  readonly maxQualityRank: number;
  readonly dynamicRanges: readonly string[];
  readonly servers: readonly string[];
  readonly streamHosts: readonly string[];
  readonly selectedStream?: StreamSummary;
  readonly streams: readonly StreamSummary[];
  readonly sourceLabels: readonly string[];
  readonly streamReachabilityVerified: boolean;
  readonly probe?: {
    readonly outcome: "reachable" | "unreachable" | "refused" | "inconclusive" | "not-run";
    readonly durationMs?: number;
    readonly reason?: string;
    readonly contentType?: string;
  };
  readonly decode?: DecodeAudit;
  readonly trace?: {
    readonly eventCount: number;
    readonly lastEvent?: unknown;
    readonly sourceAttempts?: unknown;
  };
};

type DecodeAudit = {
  readonly attempted: boolean;
  readonly ok: boolean;
  readonly reason?: string;
  readonly pngPath?: string;
  readonly bytes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
};

type CaseAudit = {
  readonly key: string;
  readonly lane: "movie" | "series" | "anime" | "youtube";
  readonly fixture: string;
  readonly expectation?: string;
  readonly audio?: "sub" | "dub";
  readonly titleSource?: "verified-search" | "query-only";
  readonly search?: SearchAudit;
  readonly episodeList?: EpisodeListAudit;
  readonly resolve: ResolveAudit;
};

type ProviderAudit = {
  readonly provider: string;
  readonly lane: "movie/series" | "anime" | "youtube";
  readonly manifest: {
    readonly domain?: string;
    readonly recommended: boolean;
    readonly capabilities: readonly string[];
    readonly catalogIdentity?: string;
    readonly relaySafe: boolean;
  };
  readonly cases: readonly CaseAudit[];
  readonly aggregate: {
    readonly resolved: number;
    readonly exhausted: number;
    readonly errors: number;
    readonly probesReachable: number;
    readonly probesUnreachable: number;
    readonly probesRefused: number;
    readonly decodeOk: boolean;
    readonly decodePngPath?: string;
    readonly fastestResolveMs?: number;
    readonly medianResolveMs?: number;
    readonly maxQualityRank: number;
    readonly servers: readonly string[];
    readonly streamHosts: readonly string[];
    readonly audioLanguages: readonly string[];
    readonly subtitleLanguages: readonly string[];
  };
};

createProviderSmokeProfile("capability-audit");
const { createContainer, disposeContainer } = await import("@/container");
const auditContainer = await createContainer({ debug: true });
const decodedProviders = new Set<string>();
let decodeEnabled = false;
let framesRoot = "";

try {
  await runCapabilityAudit();
} finally {
  await disposeContainer(auditContainer);
}

async function runCapabilityAudit(): Promise<void> {
  const requested = new Set(directSmokeArgs().map((arg) => arg.toLowerCase()));
  const providerIds: readonly ProviderId[] =
    requested.size === 0
      ? ALL_PROVIDER_IDS
      : ALL_PROVIDER_IDS.filter((id) => requested.has(id) || requested.has(providerLane(id)));
  decodeEnabled = auditDecodeEnabled();
  framesRoot = auditFramesRoot();
  mkdirSync(framesRoot, { recursive: true });

  if (providerIds.length === 0) {
    console.log(
      JSON.stringify({
        ok: false,
        stage: "selection",
        requested: [...requested],
        available: ALL_PROVIDER_IDS,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const providers: ProviderAudit[] = [];
  for (const providerId of providerIds) {
    providers.push(await auditProvider(auditContainer, providerId));
  }

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    isolatedProfile: true,
    framesRoot,
    decodeEnabled,
    fixtures: {
      movies: MOVIE_FIXTURES.map((fixture) => fixture.title.name),
      series: SERIES_FIXTURES.map(
        (fixture) => `${fixture.title.name} S${fixture.season}E${fixture.episode}`,
      ),
      anime: ANIME_FIXTURES.map(
        (fixture) => `${fixture.query} E${fixture.episode} (${fixture.expectation}, sub+dub)`,
      ),
      youtube: `${YOUTUBE_FIXTURE.query} (${YOUTUBE_FIXTURE.expectedId})`,
    },
    providers,
  };
  const json = `${JSON.stringify(
    report,
    (_key, value) => (isJsonString(value) ? redactText(value) : value),
    2,
  )}\n`;
  console.log(json.trimEnd());
  const artifactPath = auditArtifactPath();
  if (artifactPath) {
    await Bun.write(resolvePath(artifactPath), json);
  }
}

function auditDecodeEnabled(): boolean {
  return process.env.KUNAI_AUDIT_DECODE !== "0";
}

function auditFramesRoot(): string {
  return (
    process.env.KUNAI_AUDIT_FRAMES_DIR?.trim() ||
    mkdtempSync(join(tmpdir(), "kunai-provider-audit-frames-"))
  );
}

function auditArtifactPath(): string | undefined {
  return process.env.KUNAI_AUDIT_ARTIFACT?.trim();
}

function providerLane(providerId: ProviderId): "movie/series" | "anime" | "youtube" {
  if (MOVIE_PROVIDER_IDS.some((id) => id === providerId)) return "movie/series";
  if (ANIME_PROVIDER_IDS.some((id) => id === providerId)) return "anime";
  return "youtube";
}

function isMovieProviderId(providerId: ProviderId): providerId is MovieProviderId {
  return MOVIE_PROVIDER_IDS.some((id) => id === providerId);
}

function isAnimeProviderId(providerId: ProviderId): providerId is AnimeProviderId {
  return ANIME_PROVIDER_IDS.some((id) => id === providerId);
}

async function auditProvider(
  container: ProviderContainer,
  providerId: ProviderId,
): Promise<ProviderAudit> {
  const lane = providerLane(providerId);
  const cases: CaseAudit[] = [];
  const manifest = container.providerRegistry.getManifest(providerId);

  if (isMovieProviderId(providerId)) {
    for (const fixture of MOVIE_FIXTURES) {
      cases.push(await auditMovieLikeCase(container, providerId, fixture, "movie"));
    }
    for (const fixture of SERIES_FIXTURES) {
      cases.push(await auditMovieLikeCase(container, providerId, fixture, "series"));
    }
  } else if (isAnimeProviderId(providerId)) {
    for (const fixture of ANIME_FIXTURES) {
      const searched = await searchAnimeFixture(container, providerId, fixture);
      for (const audio of ["sub", "dub"] as const) {
        cases.push(
          await auditAnimeCase(
            container,
            providerId,
            fixture,
            audio,
            searched.title,
            searched.search,
          ),
        );
      }
    }
  } else {
    cases.push(await auditYoutubeCase(container, providerId));
  }

  const successfulResolves = cases
    .map((item) => item.resolve)
    .filter((item) => item.ok && item.resolveDurationMs !== null);
  const latencies = successfulResolves
    .map((item) => item.resolveDurationMs ?? 0)
    .sort((left, right) => left - right);
  const decode = cases.map((item) => item.resolve.decode).find((item) => item?.ok);
  const aggregate: ProviderAudit["aggregate"] = {
    resolved: cases.filter((item) => item.resolve.ok).length,
    exhausted: cases.filter((item) => item.resolve.status === "exhausted").length,
    errors: cases.filter((item) => item.resolve.status === "error").length,
    probesReachable: cases.filter((item) => item.resolve.probe?.outcome === "reachable").length,
    probesUnreachable: cases.filter((item) => item.resolve.probe?.outcome === "unreachable").length,
    probesRefused: cases.filter((item) => item.resolve.probe?.outcome === "refused").length,
    decodeOk: Boolean(decode),
    maxQualityRank: Math.max(0, ...cases.map((item) => item.resolve.maxQualityRank)),
    servers: uniqueStrings(cases.flatMap((item) => item.resolve.servers)),
    streamHosts: uniqueStrings(cases.flatMap((item) => item.resolve.streamHosts)),
    audioLanguages: uniqueStrings(cases.flatMap((item) => item.resolve.audioLanguages)),
    subtitleLanguages: uniqueStrings(cases.flatMap((item) => item.resolve.subtitleLanguages)),
  };
  if (decode?.pngPath) Object.assign(aggregate, { decodePngPath: decode.pngPath });
  if (latencies.length > 0) {
    Object.assign(aggregate, {
      fastestResolveMs: latencies[0],
      medianResolveMs: medianOfSorted(latencies),
    });
  }
  return {
    provider: providerId,
    lane,
    manifest: {
      domain: manifest?.domain,
      recommended: manifest?.recommended === true,
      capabilities: manifest?.capabilities ?? [],
      catalogIdentity: manifest?.catalogIdentity,
      relaySafe: manifest?.relaySafe === true,
    },
    cases,
    aggregate,
  };
}

async function auditMovieLikeCase(
  container: ProviderContainer,
  providerId: MovieProviderId,
  fixture: MovieFixture | SeriesFixture,
  lane: "movie" | "series",
): Promise<CaseAudit> {
  const episode =
    fixture.kind === "series" ? { season: fixture.season, episode: fixture.episode } : undefined;
  const languageProfile =
    fixture.kind === "movie"
      ? container.config.movieLanguageProfile
      : container.config.seriesLanguageProfile;
  const key = fixture.key;
  const request: Parameters<typeof resolveProviderSmokeStream>[0]["request"] = {
    title: fixture.title,
    audioPreference: languageProfile.audio,
    subtitlePreference: languageProfile.subtitle,
    qualityPreference: languageProfile.quality,
  };
  if (episode) Object.assign(request, { episode });
  const resolution = await resolveAndMeasure({
    container,
    providerId,
    mode: "series",
    request,
    decodeKey: `${providerId}-${key}`,
    decodeEnabled,
    framesRoot,
  });
  return {
    key,
    lane,
    fixture: fixture.title.name,
    search: { support: "not-in-provider-contract" },
    resolve: resolution,
  };
}

async function searchAnimeFixture(
  container: ProviderContainer,
  providerId: AnimeProviderId,
  fixture: AnimeFixture,
): Promise<{ readonly title: TitleInfo | null; readonly search: SearchAudit }> {
  const provider = container.providerRegistry.get(providerId);
  if (!provider?.search) {
    return { title: null, search: { support: "not-in-provider-contract" } };
  }
  const started = Date.now();
  try {
    const results = await provider.search(fixture.query, {
      audioPreference: container.config.animeLanguageProfile.audio,
      subtitlePreference: container.config.animeLanguageProfile.subtitle,
    });
    const durationMs = Date.now() - started;
    if (results === null) {
      return {
        title: null,
        search: {
          support: "provider-search",
          status: "transport-error",
          durationMs,
          resultCount: 0,
        },
      };
    }
    const selected = chooseSearchResult(results, fixture.query);
    if (!selected) {
      return {
        title: null,
        search: {
          support: "provider-search",
          status: results.length === 0 ? "empty" : "no-verified-match",
          durationMs,
          resultCount: results.length,
        },
      };
    }
    return {
      title: titleInfoFromSearchResult(selected, selected.title),
      search: {
        support: "provider-search",
        status: results.length === 0 ? "empty" : "ok",
        durationMs,
        resultCount: results.length,
        selectedTitle: selected.title,
        selectedId: selected.id,
        selectedYear: selected.year,
      },
    };
  } catch (error) {
    return {
      title: null,
      search: {
        support: "provider-search",
        status: "error",
        durationMs: Date.now() - started,
        error: redactText(errorMessage(error)),
      },
    };
  }
}

async function auditAnimeCase(
  container: ProviderContainer,
  providerId: AnimeProviderId,
  fixture: AnimeFixture,
  audio: "sub" | "dub",
  searchedTitle: TitleInfo | null,
  search: SearchAudit,
): Promise<CaseAudit> {
  const title = searchedTitle ?? {
    id: fixture.query,
    type: "series" as const,
    name: fixture.query,
  };
  const audioPreference = audio === "dub" ? "en" : "original";
  const episodeList =
    audio === "sub" && searchedTitle
      ? await auditEpisodeList(container, providerId, searchedTitle)
      : undefined;
  const resolution = await resolveAndMeasure({
    container,
    providerId,
    mode: "anime",
    request: {
      title,
      episode: { season: 1, episode: fixture.episode },
      audioPreference,
      subtitlePreference: container.config.animeLanguageProfile.subtitle,
      qualityPreference: container.config.animeLanguageProfile.quality,
    },
    decodeKey: `${providerId}-${fixture.key}-${audio}`,
    decodeEnabled,
    framesRoot,
  });
  const audit: CaseAudit = {
    key: `${fixture.key}-${audio}`,
    lane: "anime",
    fixture: `${fixture.query} E${fixture.episode}`,
    expectation: fixture.expectation,
    audio,
    titleSource: searchedTitle ? "verified-search" : "query-only",
    search,
    resolve: resolution,
  };
  if (episodeList) Object.assign(audit, { episodeList });
  return audit;
}

async function auditEpisodeList(
  container: ProviderContainer,
  providerId: AnimeProviderId,
  title: TitleInfo,
): Promise<EpisodeListAudit> {
  const provider = container.providerRegistry.get(providerId);
  if (!provider?.listEpisodes) return { support: "not-in-provider-contract" };
  const started = Date.now();
  try {
    const episodes = await provider.listEpisodes(
      {
        title,
        audioPreference: container.config.animeLanguageProfile.audio,
        subtitlePreference: container.config.animeLanguageProfile.subtitle,
      },
      AbortSignal.timeout(15_000),
    );
    return {
      support: "episode-list",
      status: episodes === null ? "transport-error" : episodes.length === 0 ? "empty" : "ok",
      durationMs: Date.now() - started,
      count: episodes?.length ?? 0,
      firstLabels: episodes?.slice(0, 3).map((episode) => episode.label) ?? [],
    };
  } catch (error) {
    return {
      support: "episode-list",
      status: "error",
      durationMs: Date.now() - started,
      error: redactText(errorMessage(error)),
    };
  }
}

async function auditYoutubeCase(
  container: ProviderContainer,
  providerId: (typeof YOUTUBE_PROVIDER_IDS)[number],
): Promise<CaseAudit> {
  const provider = container.providerRegistry.get(providerId);
  let search: SearchAudit = { support: "not-in-provider-contract" };
  let title: TitleInfo = {
    id: `youtube:${YOUTUBE_FIXTURE.expectedId}`,
    type: "movie",
    name: YOUTUBE_FIXTURE.query,
    externalIds: { youtubeId: YOUTUBE_FIXTURE.expectedId },
  };
  if (provider?.search) {
    const started = Date.now();
    try {
      const results = await provider.search(YOUTUBE_FIXTURE.query, {
        audioPreference: container.config.youtubeLanguageProfile.audio,
        subtitlePreference: container.config.youtubeLanguageProfile.subtitle,
      });
      const selected = results?.find(
        (result) =>
          result.externalIds?.youtubeId === YOUTUBE_FIXTURE.expectedId ||
          result.id === `youtube:${YOUTUBE_FIXTURE.expectedId}`,
      );
      const searchAudit: SearchAudit = {
        support: "provider-search",
        status: results === null ? "transport-error" : results.length === 0 ? "empty" : "ok",
        durationMs: Date.now() - started,
        resultCount: results?.length ?? 0,
      };
      if (results !== null) Object.assign(searchAudit, { expectedIdFound: Boolean(selected) });
      if (selected) {
        Object.assign(searchAudit, {
          selectedTitle: selected.title,
          selectedId: selected.id,
          selectedYear: selected.year,
        });
      }
      search = searchAudit;
      if (selected) title = titleInfoFromSearchResult(selected, selected.title);
    } catch (error) {
      search = {
        support: "provider-search",
        status: "error",
        durationMs: Date.now() - started,
        error: redactText(errorMessage(error)),
      };
    }
  }

  const resolution = await resolveAndMeasure({
    container,
    providerId,
    mode: "youtube",
    request: {
      title,
      audioPreference: container.config.youtubeLanguageProfile.audio,
      subtitlePreference: container.config.youtubeLanguageProfile.subtitle,
      qualityPreference: container.config.youtubeLanguageProfile.quality,
    },
    decodeKey: `${providerId}-${YOUTUBE_FIXTURE.key}`,
    decodeEnabled,
    framesRoot,
  });
  return {
    key: YOUTUBE_FIXTURE.key,
    lane: "youtube",
    fixture: YOUTUBE_FIXTURE.query,
    search,
    resolve: resolution,
  };
}

async function resolveAndMeasure(input: {
  readonly container: ProviderContainer;
  readonly providerId: string;
  readonly mode: "series" | "anime" | "youtube";
  readonly request: Parameters<typeof resolveProviderSmokeStream>[0]["request"];
  readonly decodeKey: string;
  readonly decodeEnabled: boolean;
  readonly framesRoot: string;
}): Promise<ResolveAudit> {
  let result: ProviderResolveResult | null = null;
  let stream: StreamInfo | null = null;
  let resolveDurationMs: number | null = null;
  let resolveError: unknown;
  let resolveThrew = false;
  try {
    const resolved = await resolveProviderSmokeStream({
      container: input.container,
      providerId: input.providerId,
      mode: input.mode,
      request: input.request,
    });
    result = resolved.result;
    stream = resolved.stream;
    resolveDurationMs = resolved.resolveDurationMs;
  } catch (error) {
    resolveThrew = true;
    resolveError = error;
  }

  const structuredError = resolveThrew ? providerSmokeError(resolveError) : null;
  const streams = result?.streams ?? [];
  const streamSummaries = streams.slice(0, 24).map(summarizeStream);
  const selectedCandidate = stream ? findSelectedStreamCandidate(stream, result) : undefined;
  const selected = stream ? summarizeSelectedStream(stream, result) : undefined;
  const probe = await probeSelectedStream(stream, selectedCandidate);
  const alreadyProven = decodedProviders.has(input.providerId);
  const probeRefused = probe?.outcome === "refused";
  const decode = stream
    ? await decodeFirstFrame({
        stream,
        key: input.decodeKey,
        enabled: input.decodeEnabled && !alreadyProven && !probeRefused,
        framesRoot: input.framesRoot,
        skipReason: alreadyProven
          ? "decode already proven for this provider"
          : probeRefused
            ? "network guard refused the independent probe target"
            : undefined,
      })
    : { attempted: false, ok: false, reason: "no stream resolved" };
  if (decode.ok) decodedProviders.add(input.providerId);
  const traceSummary = summarizeProviderTraceEvents(result?.trace.events);
  const subtitleLanguages = uniqueStrings(
    (result?.subtitles ?? [])
      .map((subtitle) => subtitle.language)
      .filter((value): value is string => Boolean(value)),
  );
  const audioLanguages = uniqueStrings(streams.flatMap((item) => item.audioLanguages ?? []));
  const qualities = uniqueStrings(
    streams.map((item) => item.qualityLabel).filter((value): value is string => Boolean(value)),
  );
  const servers = uniqueStrings(
    streams.map((item) => item.serverName).filter((value): value is string => Boolean(value)),
  );
  const dynamicRanges = uniqueStrings(streams.map((item) => item.dynamicRange));

  const audit: ResolveAudit = {
    ok: Boolean(stream && (stream.url || stream.deferredLocator)),
    status: result?.status ?? "error",
    resolveDurationMs,
    failureCodes:
      structuredError?.failureCodes ?? result?.failures.map((failure) => failure.code) ?? [],
    failureMessages:
      structuredError?.failureMessages ??
      result?.failures.map((failure) => redactText(failure.message)) ??
      [],
    streamCount: streams.length,
    sourceCount: result?.sources?.length ?? 0,
    variantCount: result?.variants?.length ?? 0,
    subtitleCount: result?.subtitles.length ?? 0,
    subtitleLanguages,
    audioLanguages,
    qualities,
    maxQualityRank: Math.max(0, ...streams.map((item) => item.qualityRank ?? 0)),
    dynamicRanges,
    servers,
    streamHosts: uniqueStrings(
      streams.map((item) => streamHost(item)).filter((value): value is string => value !== null),
    ),
    streams: streamSummaries,
    sourceLabels: uniqueStrings(
      (result?.sources ?? [])
        .map((source) => source.label ?? source.host ?? source.id)
        .filter((value): value is string => Boolean(value)),
    ),
    streamReachabilityVerified: result?.streamReachabilityVerified === true,
    probe,
    decode,
    trace: {
      eventCount: traceSummary.eventCount,
      lastEvent: traceSummary.lastEvent,
      sourceAttempts: traceSummary.sourceAttempts,
    },
  };
  if (structuredError?.error) Object.assign(audit, { error: redactText(structuredError.error) });
  if (selected) Object.assign(audit, { selectedStream: selected });
  return audit;
}

async function probeSelectedStream(
  stream: StreamInfo | null,
  selectedCandidate?: StreamCandidate,
): Promise<ResolveAudit["probe"]> {
  if (!stream?.url || stream.deferredLocator || !/^https?:\/\//i.test(stream.url)) {
    return { outcome: "not-run" };
  }
  if (stream.requiresYtdl) {
    return {
      outcome: "not-run",
      reason:
        "watch-page locator; media reachability is established by yt-dlp decode, not the HTML probe",
    };
  }
  const started = Date.now();
  try {
    const playlist =
      selectedCandidate?.protocol === "hls" ||
      selectedCandidate?.protocol === "dash" ||
      isHlsPlaylistUrl(stream.url) ||
      /\.mpd(?:[?#]|$)/i.test(stream.url);
    const probe = await probeStreamReachability({
      url: stream.url,
      headers: stream.headers,
      requireDirectMedia: !playlist,
      timeoutMs: 5_000,
    });
    const reachable = smokeStreamReachable(probe);
    const guardRefused = probe.status === "unreachable" && isNetworkGuardRefusal(probe.reason);
    const audit: NonNullable<ResolveAudit["probe"]> = {
      outcome: guardRefused
        ? "refused"
        : reachable === true
          ? "reachable"
          : reachable === false
            ? "unreachable"
            : "inconclusive",
      durationMs: Date.now() - started,
    };
    if (probe.status === "unreachable") Object.assign(audit, { reason: redactText(probe.reason) });
    if (probe.status === "reachable" && probe.contentType) {
      Object.assign(audit, { contentType: probe.contentType });
    }
    return audit;
  } catch (error) {
    return {
      outcome: "inconclusive",
      durationMs: Date.now() - started,
      reason: redactText(errorMessage(error)),
    };
  }
}

async function decodeFirstFrame(input: {
  readonly stream: StreamInfo;
  readonly key: string;
  readonly enabled: boolean;
  readonly framesRoot: string;
  readonly skipReason?: string;
}): Promise<DecodeAudit> {
  if (!input.enabled) {
    return { attempted: false, ok: false, reason: input.skipReason ?? "decode disabled" };
  }
  const mpv = Bun.which("mpv");
  if (!mpv) return { attempted: false, ok: false, reason: "mpv missing on PATH" };

  const started = Date.now();
  const outputDir = mkdtempSync(join(tmpdir(), "kunai-audit-frame-"));
  let materializedCleanup: (() => Promise<void>) | null = null;
  try {
    const materialized = await materializeDeferredMediaForPlayback(input.stream);
    materializedCleanup = materialized.cleanup;
    const stream = materialized.stream;
    const targetName = `${sanitizeFileName(input.key)}.png`;
    const targetPath = join(input.framesRoot, targetName);
    const headers = normalizeStreamHttpHeaders(stream.headers);
    const headerFields = [
      ...(headers.origin ? [`Origin: ${headers.origin}`] : []),
      ...headers.extraFields,
    ];
    const args = [
      "--no-config",
      "--force-window=no",
      "--ao=null",
      "--vo=image",
      "--vo-image-format=png",
      `--vo-image-outdir=${outputDir}`,
      // Zero is often a fade-in black frame even when the stream is healthy;
      // a written black PNG proves decode mechanically but not visually.
      "--start=10",
      "--frames=1",
      "--cache=yes",
      "--really-quiet",
      ...(headers.referer ? [`--referrer=${cleanMpvArg(headers.referer)}`] : []),
      ...(headers.userAgent ? [`--user-agent=${cleanMpvArg(headers.userAgent)}`] : []),
      ...(headerFields.length > 0
        ? [`--http-header-fields=${cleanMpvArg(headerFields.join(","))}`]
        : []),
      ...(stream.requiresYtdl
        ? [
            "--ytdl=yes",
            `--ytdl-format=${stream.ytdlFormat ?? "bv*+ba/b/ba"}`,
            `--ytdl-raw-options=${guardedYtdlRawOptions(stream.ytdlRawOptions)}`,
          ]
        : []),
      ...(isMp4uploadHost(hostnameOf(stream.url)) ? ["--tls-verify=no"] : []),
      "--",
      stream.url,
    ];
    const child = Bun.spawn([mpv, ...args], { stdout: "pipe", stderr: "pipe" });
    const timeoutMs = 45_000;
    const outcome = await Promise.race([
      child.exited.then((exitCode) => ({ type: "exit" as const, exitCode })),
      Bun.sleep(timeoutMs).then(() => ({ type: "timeout" as const })),
    ]);
    if (outcome.type === "timeout") {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited.
      }
      const exited = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(2_000).then(() => false),
      ]);
      if (!exited) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited.
        }
      }
      await child.exited;
      return {
        attempted: true,
        ok: false,
        reason: "mpv did not write a PNG within 45s",
        durationMs: Date.now() - started,
      };
    }

    const written = readdirSync(outputDir)
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .sort();
    if (written.length === 0) {
      const stderr = await new Response(child.stderr).text();
      return {
        attempted: true,
        ok: false,
        reason: redactText(
          stderr.trim() || `mpv exited ${outcome.exitCode} without writing a PNG frame`,
        ).slice(0, 500),
        durationMs: Date.now() - started,
      };
    }

    const writtenPath = join(outputDir, written[0] ?? "");
    const dimensions = pngDimensions(writtenPath);
    if (!dimensions) {
      return {
        attempted: true,
        ok: false,
        reason: "mpv wrote a PNG whose dimensions could not be validated",
        bytes: statSync(writtenPath).size,
        durationMs: Date.now() - started,
      };
    }
    copyFileSync(writtenPath, targetPath);
    return {
      attempted: true,
      ok: true,
      pngPath: targetPath,
      bytes: statSync(targetPath).size,
      ...dimensions,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      reason: redactText(errorMessage(error)),
      durationMs: Date.now() - started,
    };
  } finally {
    if (materializedCleanup) await materializedCleanup().catch(() => {});
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function summarizeSelectedStream(
  stream: StreamInfo,
  result: ProviderResolveResult | null,
): StreamSummary {
  const selected =
    // Id first: two candidates can share a URL with different headers or quality.
    result?.streams.find((item) => item.id === result.selectedStreamId) ??
    result?.streams.find((item) => (item.url ?? item.deferredLocator) === stream.url);
  if (selected) return summarizeStream(selected);
  const summary: StreamSummary = {
    id: result?.selectedStreamId ?? "selected",
    host: hostnameOf(stream.url) || null,
    protocol: stream.requiresYtdl ? "youtube" : "unknown",
    audioLanguages: stream.audioLanguages ?? [],
    subtitleLanguages:
      stream.subtitleList
        ?.map((subtitle) => subtitle.language)
        .filter((value): value is string => Boolean(value)) ?? [],
    deferred: Boolean(stream.deferredLocator),
    headerKeys: Object.keys(stream.headers),
    metadataKeys: [],
  };
  if (stream.hardSubLanguage) Object.assign(summary, { hardSubLanguage: stream.hardSubLanguage });
  return summary;
}

function summarizeStream(stream: StreamCandidate): StreamSummary {
  const summary: StreamSummary = {
    id: stream.id,
    host: streamHost(stream),
    protocol: stream.protocol,
    audioLanguages: stream.audioLanguages ?? [],
    subtitleLanguages: stream.subtitleLanguages ?? [],
    deferred: Boolean(stream.deferredLocator),
    headerKeys: Object.keys(stream.headers ?? {}),
    metadataKeys: Object.keys(stream.metadata ?? {}),
  };
  if (stream.container) Object.assign(summary, { container: stream.container });
  if (stream.serverName) Object.assign(summary, { serverName: stream.serverName });
  if (stream.qualityLabel) Object.assign(summary, { qualityLabel: stream.qualityLabel });
  if (stream.qualityRank !== undefined) Object.assign(summary, { qualityRank: stream.qualityRank });
  if (stream.dynamicRange) Object.assign(summary, { dynamicRange: stream.dynamicRange });
  if (stream.presentation) Object.assign(summary, { presentation: stream.presentation });
  if (stream.hardSubLanguage) Object.assign(summary, { hardSubLanguage: stream.hardSubLanguage });
  if (stream.subtitleDelivery)
    Object.assign(summary, { subtitleDelivery: stream.subtitleDelivery });
  if (stream.flavorArchetype) Object.assign(summary, { flavorArchetype: stream.flavorArchetype });
  if (stream.flavorLabel) Object.assign(summary, { flavorLabel: stream.flavorLabel });
  if (stream.requiresYtdl) Object.assign(summary, { requiresYtdl: stream.requiresYtdl });
  if (stream.metadata)
    Object.assign(summary, { metadataScalars: safeMetadataScalars(stream.metadata) });
  return summary;
}

function safeMetadataScalars(
  metadata: NonNullable<StreamCandidate["metadata"]>,
): readonly MetadataScalar[] {
  const allowed = new Set([
    "backend",
    "server",
    "source",
    "sourceName",
    "host",
    "formatId",
    "playerClient",
    "extractorArgs",
    "durationSeconds",
    "isLive",
    "liveStatus",
    "hasAudio",
    "height",
    "width",
    "fps",
    "vcodec",
    "acodec",
    "language",
    "audioMode",
    "embedHost",
    "lane",
  ]);
  const out: MetadataScalar[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.has(key)) continue;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) continue;
    out.push({ key, value: redactText(serialized).slice(0, 160) });
  }
  return out;
}

function streamHost(stream: StreamCandidate): string | null {
  const url = stream.url ?? stream.deferredLocator;
  return url ? hostnameOf(url) || null : null;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function chooseSearchResult(
  results: readonly SearchResult[],
  query: string,
): SearchResult | undefined {
  const normalizedQuery = normalizeTitle(query);
  return results.find(
    (result) =>
      normalizeTitle(result.title) === normalizedQuery ||
      result.titleAliases?.some((alias) => normalizeTitle(alias.value) === normalizedQuery),
  );
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function medianOfSorted(values: readonly number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] ?? 0)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

function isNetworkGuardRefusal(reason: string): boolean {
  return (
    reason === "blocked-target" ||
    reason.startsWith("blocked stream target:") ||
    reason.startsWith("HLS segment blocked:")
  );
}

function isMp4uploadHost(hostname: string): boolean {
  return hostname === "mp4upload.com" || hostname.endsWith(".mp4upload.com");
}

function findSelectedStreamCandidate(
  stream: StreamInfo,
  result: ProviderResolveResult | null,
): StreamCandidate | undefined {
  return (
    // Id first: two candidates can share a URL with different headers or quality.
    result?.streams.find((item) => item.id === result.selectedStreamId) ??
    result?.streams.find((item) => (item.url ?? item.deferredLocator) === stream.url)
  );
}

function redactText(value: string): string {
  return (
    value
      .replace(/https?:\/\/[^\s"')]+/gi, (url) => `https://${hostnameOf(url) || "REDACTED"}`)
      // yt-dlp extractor args can carry a PO token (`po_token=web+TOKEN`).
      .replace(/(po_token=)(?:\\?["'])?[^;\s"'\\)]+/gi, "$1REDACTED")
      .replace(/\/home\/[^\s"')]+/gi, "/home/REDACTED")
      .replace(/\/Users\/[^\s"')]+/g, "/Users/REDACTED")
      .replace(/[A-Z]:\\Users\\[^\s"')]+/gi, "C:\\Users\\REDACTED")
  );
}

function cleanMpvArg(value: string): string {
  return value.replace(/[\r\n]/g, "");
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[^a-z0-9_.-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function pngDimensions(path: string): { readonly width: number; readonly height: number } | null {
  try {
    const decoded = decodePng(new Uint8Array(readFileSync(path)));
    if (decoded.width <= 0 || decoded.height <= 0) return null;
    return { width: decoded.width, height: decoded.height };
  } catch {
    return null;
  }
}
