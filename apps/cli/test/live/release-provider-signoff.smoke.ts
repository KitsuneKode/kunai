/**
 * Opt-in live release signoff for default movie/series/anime routes.
 *
 * Safe by default: without KUNAI_LIVE_RELEASE_SIGNOFF=1 this prints a skipped
 * JSON payload and does not hit the network.
 *
 * Run:
 *   KUNAI_LIVE_RELEASE_SIGNOFF=1 bun run test:live:release-signoff
 *   KUNAI_LIVE_RELEASE_SIGNOFF=1 KUNAI_MATRIX_ARTIFACT="$PWD/artifacts/release-provider-signoff.json" \
 *     bun run test:live:release-signoff
 *
 * Evidence is redacted (no stream URL / token / cookie / home path). Acceptance
 * for final approval also requires freshness ≤24h and all routes resolved+reachable.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TitleInfo } from "@/domain/types";
import { isStreamReachableForResolve, probeStreamReachability } from "@kunai/providers";

import {
  createProviderSmokeProfile,
  providerSmokeError,
  resolveProviderSmokeStream,
} from "./provider-smoke";
import {
  buildReleaseProviderSignoff,
  classifyReleaseSignoffFailure,
  redactVolatileSignoffText,
  type ReleaseProviderSignoffRoute,
  type ReleaseSignoffLane,
} from "./release-provider-signoff";

const CLI_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

type DefaultRouteFixture = {
  readonly lane: ReleaseSignoffLane;
  readonly configuredProvider: string;
  readonly mode: "series" | "anime";
  readonly title: TitleInfo;
  readonly season?: number;
  readonly episode?: number;
};

const DEFAULT_ROUTES: readonly DefaultRouteFixture[] = [
  {
    lane: "movie",
    configuredProvider: "videasy",
    mode: "series",
    title: { id: "438631", type: "movie", name: "Dune", year: "2021" },
  },
  {
    lane: "series",
    configuredProvider: "videasy",
    mode: "series",
    title: { id: "299167", type: "series", name: "Dutton Ranch", year: "2026" },
    season: 1,
    episode: 1,
  },
  {
    lane: "anime",
    configuredProvider: "allanime",
    mode: "anime",
    title: {
      id: "SJms742bSTrcyJZay",
      type: "series",
      name: "Kimetsu no Yaiba",
      isAnime: true,
    },
    season: 1,
    episode: 1,
  },
];

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return typeof pkg.version === "string" ? pkg.version : "";
}

function readCommitSha(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return "";
  return new TextDecoder().decode(result.stdout).trim();
}

async function writeArtifact(path: string, payload: unknown): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(payload, null, 2)}\n`);
}

async function resolveRoute(
  fixture: DefaultRouteFixture,
  container: Awaited<ReturnType<typeof import("@/container").createContainer>>,
): Promise<ReleaseProviderSignoffRoute> {
  const startedAt = Date.now();
  const language =
    fixture.lane === "anime"
      ? container.config.animeLanguageProfile
      : fixture.lane === "movie"
        ? container.config.movieLanguageProfile
        : container.config.seriesLanguageProfile;

  let resolveError: unknown = null;
  let failureCodes: readonly string[] = [];
  let streamCandidates = 0;
  let successfulProvider: string | null = null;
  let streamUrl: string | null = null;
  let streamHeaders: Record<string, string> | undefined;

  try {
    const resolved = await resolveProviderSmokeStream({
      container,
      providerId: fixture.configuredProvider,
      mode: fixture.mode,
      request: {
        title: fixture.title,
        ...(fixture.season !== undefined && fixture.episode !== undefined
          ? { episode: { season: fixture.season, episode: fixture.episode } }
          : {}),
        audioPreference: language.audio,
        subtitlePreference: language.subtitle,
        qualityPreference: language.quality,
      },
    });
    failureCodes = resolved.result.failures.map((failure) => failure.code);
    streamCandidates = resolved.result.streams.length;
    streamUrl = resolved.stream?.url ?? null;
    streamHeaders = resolved.stream?.headers;
    successfulProvider =
      resolved.stream?.url !== undefined && resolved.stream.url !== null
        ? (resolved.result.providerId ??
          resolved.result.trace.selectedProviderId ??
          fixture.configuredProvider)
        : null;
  } catch (error) {
    resolveError = error;
    const recovered = providerSmokeError(error);
    failureCodes = recovered.failureCodes ?? [];
    streamCandidates = recovered.streamCandidates ?? 0;
  }

  const streamProbe = streamUrl
    ? await probeStreamReachability({
        url: streamUrl,
        headers: streamHeaders,
        timeoutMs: 5_000,
      })
    : null;
  const streamReachable = streamProbe
    ? isStreamReachableForResolve(streamProbe)
    : streamUrl
      ? false
      : null;
  const resolved = Boolean(streamUrl);
  const errorText =
    resolveError instanceof Error
      ? redactVolatileSignoffText(resolveError.message)
      : resolveError
        ? redactVolatileSignoffText(String(resolveError))
        : null;

  return {
    lane: fixture.lane,
    configuredProvider: fixture.configuredProvider,
    successfulProvider,
    resolved,
    streamCandidates,
    streamReachable,
    failureClass: classifyReleaseSignoffFailure({
      resolved,
      streamReachable,
      error: errorText,
      failureCodes,
    }),
    durationMs: Date.now() - startedAt,
  };
}

if (process.env.KUNAI_LIVE_RELEASE_SIGNOFF !== "1") {
  printJson({
    ok: true,
    skipped: true,
    reason:
      "Set KUNAI_LIVE_RELEASE_SIGNOFF=1 (and optionally KUNAI_MATRIX_ARTIFACT) to run default-route release signoff",
  });
} else {
  const profile = createProviderSmokeProfile("release-signoff");
  const { createContainer } = await import("@/container");
  const container = await createContainer({ debug: true });

  const routes: ReleaseProviderSignoffRoute[] = [];
  for (const fixture of DEFAULT_ROUTES) {
    routes.push(await resolveRoute(fixture, container));
  }

  const signoff = buildReleaseProviderSignoff({
    generatedAt: new Date().toISOString(),
    commitSha: readCommitSha(),
    version: readPackageVersion(),
    routes,
  });

  const ok = signoff.routes.every(
    (route) => route.resolved && route.streamReachable === true && route.failureClass === null,
  );

  const report = {
    ok,
    skipped: false,
    isolatedProfile: true,
    schemaVersion: signoff.schemaVersion,
    generatedAt: signoff.generatedAt,
    commitSha: signoff.commitSha,
    version: signoff.version,
    routes: signoff.routes,
  };

  printJson(report);

  const artifactPath = process.env.KUNAI_MATRIX_ARTIFACT?.trim();
  if (artifactPath) {
    await writeArtifact(artifactPath, signoff);
  }

  // Keep profileRoot out of printed report (home/tmp path redaction contract).
  void profile;

  if (!ok) process.exitCode = 1;
}
