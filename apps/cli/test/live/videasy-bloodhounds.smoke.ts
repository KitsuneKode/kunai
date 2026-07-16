/**
 * Videasy live smoke — proves functional streams, Phase A order, and performance.
 *
 * Default (matrix-safe, single fixture):
 *   bun run test:live:videasy
 *   bun run test:live:videasy -- --fixture=bloodhounds
 *   bun run test:live:videasy -- 1 2   # season/episode override for selected fixture
 *
 * Full multi-title suite (slower, intentional):
 *   bun run test:live:videasy -- --suite
 *   KUNAI_VIDEASY_LIVE_SUITE=1 bun run test:live:videasy
 *
 * Optional:
 *   KITSUNE_CLEAR_CACHE=1
 *   KUNAI_VIDEASY_LIVE_RELAX=1          # do not hard-fail on resolve budget
 *   KITSUNE_SMOKE_STARTUP_PRIORITY=fast|balanced|quality-first
 */
import type { TitleInfo } from "@/domain/types";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";
import type { StartupPriority } from "@kunai/types";

import {
  buildProviderSmokePayload,
  createProviderSmokeProfile,
  providerSmokeError,
  providerSmokeProfilePayload,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import {
  type VideasyLiveFixture,
  evaluateVideasyLiveSmoke,
  extractVideasyProbeOrderLabels,
  resolveVideasyLiveFixtures,
  summarizeVideasySuite,
} from "./videasy-live-assertions";

const profile = createProviderSmokeProfile("videasy");
// Bun `-e` puts the script body at argv[2]; collect flags from the full argv.
const cli = parseVideasySmokeArgs(process.argv);
const clearCache = process.env.KITSUNE_CLEAR_CACHE === "1";
const relaxBudgets =
  process.env.KUNAI_VIDEASY_LIVE_RELAX === "1" || process.env.KITSUNE_LIVE_RELAX === "1";
const startupPriority = resolveSmokeStartupPriority(process.env.KITSUNE_SMOKE_STARTUP_PRIORITY);

const fixtures = resolveVideasyLiveFixtures({
  suite: cli.suite || process.env.KUNAI_VIDEASY_LIVE_SUITE === "1",
  fixtureId: cli.fixtureId ?? process.env.KUNAI_VIDEASY_FIXTURE ?? null,
}).map((fixture) => applySeasonEpisodeOverride(fixture, cli.season, cli.episode));

const { createContainer } = await import("@/container");
const container = await createContainer({ debug: true });
const provider = container.providerRegistry.get("videasy");

if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "provider", reason: "missing_videasy" }));
  process.exit(1);
}

if (clearCache) {
  await container.cacheStore.clear();
}

const fixtureResults: Array<{
  readonly fixtureId: string;
  readonly payload: Record<string, unknown>;
  readonly assertion: ReturnType<typeof evaluateVideasyLiveSmoke>;
}> = [];

for (const fixture of fixtures) {
  fixtureResults.push(
    await runVideasyFixtureSmoke({
      fixture,
      appContainer: container,
      requestedStartupPriority: startupPriority,
    }),
  );
}

const suite = summarizeVideasySuite(
  fixtureResults.map((row) => ({
    fixtureId: row.fixtureId,
    assertion: row.assertion,
  })),
);

const report = {
  ok: suite.ok,
  skipped: false,
  provider: "videasy",
  providerId: "videasy",
  mode: fixtures.length > 1 ? "suite" : "single",
  suite,
  fixtures: fixtureResults.map((row) => row.payload),
  cacheCleared: clearCache,
  startupPriority,
  relaxBudgets,
  ...providerSmokeProfilePayload(profile),
  // Matrix-compat: top-level fields mirror the first/primary fixture.
  ...matrixCompatFields(fixtureResults[0]),
};

console.log(JSON.stringify(report, null, 2));
process.exit(suite.ok ? 0 : 1);

async function runVideasyFixtureSmoke({
  fixture,
  appContainer,
  requestedStartupPriority,
}: {
  readonly fixture: VideasyLiveFixture;
  readonly appContainer: Awaited<ReturnType<typeof createContainer>>;
  readonly requestedStartupPriority: StartupPriority;
}): Promise<{
  readonly fixtureId: string;
  readonly payload: Record<string, unknown>;
  readonly assertion: ReturnType<typeof evaluateVideasyLiveSmoke>;
}> {
  const title: TitleInfo = {
    id: fixture.titleId,
    type: fixture.mediaKind === "movie" ? "movie" : "series",
    name: fixture.title,
    ...(fixture.year !== undefined ? { year: String(fixture.year) } : {}),
  };

  let resolveError: unknown = null;
  let failureCodes: readonly string[] = [];
  let failureMessages: readonly string[] = [];
  let streamCandidates = 0;
  let probeOrderLabels: readonly string[] = [];
  let selectedSourceLabel: string | null = null;
  let selectedSourceId: string | null = null;
  let sourceInventory: readonly {
    readonly id: string;
    readonly label: string | null;
    readonly status: string | null;
  }[] = [];
  let diagnosticStages: readonly string[] = [];

  const { stream, resolveDurationMs, result } = await resolveProviderSmokeStream({
    container: appContainer,
    providerId: "videasy",
    // Movie titles still use series shell mode; mediaKind comes from title.type.
    mode: "series",
    request: {
      title,
      ...(fixture.mediaKind === "series" && fixture.season && fixture.episode
        ? { episode: { season: fixture.season, episode: fixture.episode } }
        : {}),
      audioPreference:
        fixture.mediaKind === "movie"
          ? appContainer.config.movieLanguageProfile.audio
          : appContainer.config.seriesLanguageProfile.audio,
      subtitlePreference:
        fixture.mediaKind === "movie"
          ? appContainer.config.movieLanguageProfile.subtitle
          : appContainer.config.seriesLanguageProfile.subtitle,
      startupPriority: requestedStartupPriority,
    },
  })
    .then((resolved) => {
      failureCodes = resolved.result.failures.map((failure) => failure.code);
      failureMessages = resolved.result.failures.map((failure) => failure.message);
      streamCandidates = resolved.result.streams.length;
      const selectedStream =
        resolved.result.streams.find(
          (candidate) => candidate.id === resolved.result.selectedStreamId,
        ) ??
        resolved.result.streams[0] ??
        null;
      selectedSourceId = selectedStream?.sourceId ?? null;
      const selectedSource =
        resolved.result.sources?.find((source) => source.id === selectedSourceId) ?? null;
      selectedSourceLabel =
        selectedSource?.label ?? selectedStream?.flavorLabel ?? selectedStream?.serverName ?? null;
      sourceInventory = (resolved.result.sources ?? []).map((source) => ({
        id: source.id,
        label: source.label ?? null,
        status: source.status ?? null,
      }));
      const startMessages = (resolved.result.trace.events ?? [])
        .filter((event) => event.type === "source:start" || event.type === "source:failed")
        .map((event) => event.message);
      probeOrderLabels = extractVideasyProbeOrderLabels(startMessages);
      diagnosticStages = [
        ...new Set(
          (resolved.result.trace.events ?? [])
            .map((event) => event.attributes?.stage)
            .filter((stage): stage is string => typeof stage === "string"),
        ),
      ];
      return resolved;
    })
    .catch((error) => {
      resolveError = error;
      const recovered = providerSmokeError(error);
      failureCodes = recovered.failureCodes ?? [];
      failureMessages = recovered.failureMessages ?? [];
      streamCandidates = recovered.streamCandidates ?? 0;
      probeOrderLabels = extractVideasyProbeOrderLabels(
        (recovered.sourceAttempts ?? []).map((event) => event.message),
      );
      return { stream: null, resolveDurationMs: null, result: null };
    });

  const streamProbe = stream?.url
    ? await probeStreamReachability({
        url: stream.url,
        headers: stream.headers,
        timeoutMs: 5_000,
      })
    : null;

  const streamReachable = streamProbe ? isStreamReachableForResolve(streamProbe) : false;

  const assertion = evaluateVideasyLiveSmoke({
    fixture,
    streamResolved: Boolean(stream?.url),
    streamReachable,
    streamCandidates,
    resolveDurationMs,
    selectedSourceLabel,
    selectedSourceId,
    probeOrderLabels,
    failureCodes,
    relaxBudgets,
  });

  const base = buildProviderSmokePayload({
    provider: "videasy",
    title,
    season: fixture.season,
    episode: fixture.episode,
    stream,
    resolveDurationMs,
  });

  const payload = {
    ...base,
    ok: assertion.ok && base.ok && streamReachable,
    fixtureId: fixture.id,
    mediaKind: fixture.mediaKind,
    knownGoodLabels: fixture.knownGoodLabels,
    softResolveBudgetMs: fixture.softResolveBudgetMs,
    hardResolveBudgetMs: fixture.hardResolveBudgetMs,
    ...(resolveError ? providerSmokeError(resolveError) : {}),
    failureCodes,
    failureMessages,
    streamCandidates,
    selectedSourceId,
    selectedSourceLabel,
    sourceInventory,
    diagnosticStages,
    probeOrderLabels,
    streamReachable,
    streamProbeStatus: streamProbe?.status ?? null,
    assertion,
    score: assertion.score,
    checks: assertion.checks,
    cacheHit: result?.trace.cacheHit ?? base.cacheHit,
    protocol:
      stream?.providerResolveResult?.streams.find(
        (candidate) => candidate.id === stream.providerResolveResult?.selectedStreamId,
      )?.protocol ??
      stream?.providerResolveResult?.streams[0]?.protocol ??
      null,
  };

  return {
    fixtureId: fixture.id,
    payload,
    assertion: {
      ...assertion,
      ok: assertion.ok && Boolean(stream?.url) && streamReachable,
    },
  };
}

function matrixCompatFields(
  first:
    | {
        readonly payload: Record<string, unknown>;
        readonly assertion: { readonly ok: boolean };
      }
    | undefined,
): Record<string, unknown> {
  if (!first) {
    return {
      streamResolved: false,
      streamCandidates: 0,
      engine: null,
      runtime: null,
      failureCodes: ["no-fixtures"],
    };
  }
  const p = first.payload;
  return {
    title: p.title,
    titleId: p.titleId,
    type: p.type,
    season: p.season,
    episode: p.episode,
    streamResolved: p.streamResolved,
    streamHost: p.streamHost,
    streamCandidates: p.streamCandidates,
    engine: p.engine,
    runtime: p.runtime,
    cacheHit: p.cacheHit,
    failureCodes: p.failureCodes,
    resolveDurationMs: p.resolveDurationMs,
    streamReachable: p.streamReachable,
    selectedSourceLabel: p.selectedSourceLabel,
    probeOrderLabels: p.probeOrderLabels,
    score: p.score,
  };
}

function applySeasonEpisodeOverride(
  fixture: VideasyLiveFixture,
  season: number | null,
  episode: number | null,
): VideasyLiveFixture {
  if (fixture.mediaKind !== "series") return fixture;
  return {
    ...fixture,
    season: season ?? fixture.season,
    episode: episode ?? fixture.episode,
  };
}

function parseVideasySmokeArgs(argv: string[]): {
  readonly suite: boolean;
  readonly fixtureId: string | null;
  readonly season: number | null;
  readonly episode: number | null;
} {
  let runSuite = false;
  let fixtureId: string | null = null;
  const positionals: number[] = [];

  for (const arg of argv) {
    if (arg === "--suite" || arg === "-s") {
      runSuite = true;
      continue;
    }
    if (arg.startsWith("--fixture=")) {
      fixtureId = arg.slice("--fixture=".length);
      continue;
    }
    if (arg === "--fixture" || arg === "-f") {
      // next token handled loosely: allow `--fixture bloodhounds`
      continue;
    }
    if (arg.startsWith("-")) continue;
    // previous was --fixture
    const prev = argv[argv.indexOf(arg) - 1];
    if (prev === "--fixture" || prev === "-f") {
      fixtureId = arg;
      continue;
    }
    if (/^\d+$/.test(arg)) {
      positionals.push(Number.parseInt(arg, 10));
    } else if (!fixtureId && /^[a-z0-9-]+$/i.test(arg)) {
      // bare fixture id positional
      fixtureId = arg;
    }
  }

  return {
    suite: runSuite,
    fixtureId,
    season: positionals[0] ?? null,
    episode: positionals[1] ?? null,
  };
}

function resolveSmokeStartupPriority(value: string | undefined): StartupPriority {
  return value === "fast" || value === "balanced" || value === "quality-first" ? value : "balanced";
}
