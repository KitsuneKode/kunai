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

import { probeStreamReachability } from "@kunai/providers";

import {
  createProviderSmokeProfile,
  providerSmokeError,
  resolveProviderSmokeStream,
  smokeStreamReachable,
} from "./provider-smoke";
import {
  buildReleaseProviderRouteCases,
  resolveReleaseAnimeSearchTitle,
  type ReleaseProviderRouteCase,
} from "./release-provider-routes";
import {
  buildReleaseProviderSignoff,
  classifyReleaseSignoffFailure,
  redactVolatileSignoffText,
  type ReleaseProviderSignoffRoute,
} from "./release-provider-signoff";

const CLI_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

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

function requireProvider(
  container: Awaited<ReturnType<typeof import("@/container").createContainer>>,
  providerId: string,
) {
  const provider = container.providerRegistry.get(providerId);
  if (!provider) {
    throw new Error(`Configured release provider is not registered: ${providerId}`);
  }
  return provider;
}

async function resolveRoute(
  routeCase: ReleaseProviderRouteCase,
  container: Awaited<ReturnType<typeof import("@/container").createContainer>>,
): Promise<ReleaseProviderSignoffRoute> {
  const startedAt = Date.now();
  const language =
    routeCase.lane === "anime"
      ? container.config.animeLanguageProfile
      : routeCase.lane === "movie"
        ? container.config.movieLanguageProfile
        : container.config.seriesLanguageProfile;

  let resolveError: unknown = null;
  let failureCodes: readonly string[] = [];
  let streamCandidates = 0;
  let successfulProvider: string | null = null;
  let streamUrl: string | null = null;
  let streamHeaders: Record<string, string> | undefined;

  try {
    // The anime lane must prove the configured default can FIND the title
    // itself. A zero-result search throws here and is classified as drift,
    // without any engine resolve happening.
    const title =
      routeCase.lane === "anime"
        ? await resolveReleaseAnimeSearchTitle(
            routeCase,
            requireProvider(container, routeCase.configuredProvider),
            language,
          )
        : routeCase.title;

    const resolved = await resolveProviderSmokeStream({
      container,
      providerId: routeCase.configuredProvider,
      mode: routeCase.mode,
      request: {
        title,
        ...(routeCase.season !== undefined && routeCase.episode !== undefined
          ? { episode: { season: routeCase.season, episode: routeCase.episode } }
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
          routeCase.configuredProvider)
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
    ? smokeStreamReachable(streamProbe)
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
    lane: routeCase.lane,
    configuredProvider: routeCase.configuredProvider,
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

  // Derive the cases from what the product actually defaults to, and prove each
  // configured default is a registered production module before any network work.
  const cases = buildReleaseProviderRouteCases(
    {
      provider: container.config.provider,
      animeProvider: container.config.animeProvider,
    },
    container.engine.getProviderIds(),
  );

  const routes: ReleaseProviderSignoffRoute[] = [];
  for (const routeCase of cases) {
    routes.push(await resolveRoute(routeCase, container));
  }

  const signoff = buildReleaseProviderSignoff({
    generatedAt: new Date().toISOString(),
    commitSha: readCommitSha(),
    version: readPackageVersion(),
    routes,
  });

  const ok = signoff.routes.every(
    (route) =>
      route.resolved &&
      route.streamReachable === true &&
      route.failureClass === null &&
      route.successfulProvider === route.configuredProvider,
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
