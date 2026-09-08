/* oxlint-disable promise/no-multiple-resolved -- child error and close can both fire; finish is idempotent. */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  booleanOrNull,
  classifyProviderHealth,
  numberOrNull,
  parseScore,
  parseSmokeOutput,
  stringArray,
  stringOrNull,
} from "./matrix-harness.mjs";

const MATRIX = [
  {
    provider: "videasy",
    command: ["bun", "test/live/videasy-bloodhounds.smoke.ts"],
    media: "series",
    fixture: "Dutton Ranch S01E01 (Neon Phase A)",
  },
  {
    provider: "rivestream",
    command: ["bun", "-e", "await import('./test/live/rivestream-breakingbad.smoke.ts')"],
    media: "series",
    fixture: "Breaking Bad S01E01",
  },
  {
    provider: "vidlink",
    command: ["bun", "test/live/vidlink-inception.smoke.ts"],
    media: "movie",
    fixture: "Inception (DASH + playlist cookie)",
  },
  {
    provider: "anidb",
    command: ["bun", "-e", "await import('./test/live/anidb-onigiri.smoke.ts')"],
    media: "anime",
    fixture: "Onigiri S01E01",
  },
  {
    provider: "allanime",
    command: ["bun", "-e", "await import('./test/live/allanime-demonslayer.smoke.ts')"],
    media: "anime",
    fixture: "Kimetsu no Yaiba S01E01",
  },
  {
    provider: "miruro",
    command: ["bun", "-e", "await import('./test/live/miruro-demonslayer.smoke.ts')"],
    media: "anime",
    fixture: "One Piece E1159",
  },
  {
    provider: "youtube",
    command: ["bun", "-e", "await import('./test/live/youtube.smoke.ts')"],
    media: "youtube",
    fixture: "Me at the zoo (jNQXAC9IVRw)",
  },
];

const appRoot = fileURLToPath(new URL("../..", import.meta.url));

// Default movie/series/anime release evidence uses ReleaseProviderSignoff
// (apps/cli/test/live/release-provider-signoff.smoke.ts), not this full matrix.
// Opt-in: KUNAI_LIVE_RELEASE_SIGNOFF=1 bun run test:live:release-signoff
// Workflow: provider-matrix.yml mode=release-signoff → release-provider-signoff-<run_id>
if (process.argv.slice(2).some((arg) => arg.toLowerCase() === "release-signoff")) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        stage: "matrix-selection",
        error:
          "Use bun run test:live:release-signoff (KUNAI_LIVE_RELEASE_SIGNOFF=1) for default-route ReleaseProviderSignoff evidence",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  const requested = new Set(process.argv.slice(2).map((arg) => arg.toLowerCase()));
  const selected =
    requested.size > 0
      ? MATRIX.filter((entry) => requested.has(entry.provider) || requested.has(entry.media))
      : MATRIX;

  if (selected.length === 0) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          stage: "matrix-selection",
          requested: [...requested],
          available: MATRIX.map((entry) => entry.provider),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } else {
    const results = [];
    for (const entry of selected) results.push(await runMatrixEntry(entry));

    const failed = results.filter((result) => !result.ok);
    const byClass = {
      healthy: results.filter((result) => result.healthClass === "healthy").length,
      "provider-drift": results.filter((result) => result.healthClass === "provider-drift").length,
      "environment-network": results.filter(
        (result) => result.healthClass === "environment-network",
      ).length,
      "harness-failure": results.filter((result) => result.healthClass === "harness-failure")
        .length,
    };
    const report = {
      ok: failed.length === 0,
      generatedAt: new Date().toISOString(),
      selectedProviders: selected.map((entry) => entry.provider),
      summary: {
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        byClass,
      },
      results,
    };
    console.log(JSON.stringify(report, null, 2));

    const artifactPath = process.env.KUNAI_MATRIX_ARTIFACT?.trim();
    if (artifactPath) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname, resolve } = await import("node:path");
      const absoluteArtifactPath = resolve(artifactPath);
      await mkdir(dirname(absoluteArtifactPath), { recursive: true });
      await writeFile(
        absoluteArtifactPath,
        `${JSON.stringify(redactMatrixReport(report), null, 2)}\n`,
      );
    }

    if (failed.length > 0) process.exitCode = 1;
  }
}

async function runMatrixEntry(entry) {
  const { stdout, stderr, exitCode, timedOut } = await runLiveSmoke(entry.command);
  // youtube.smoke.ts emits NDJSON (primary payload + check lines); anidb
  // search-stage failures go to stderr. Parse stdout first, then stderr.
  const found = parseSmokeOutput(stdout, stderr);
  const parsed = found?.payload ?? null;
  if (!parsed) {
    const result = {
      provider: entry.provider,
      media: entry.media,
      fixture: entry.fixture,
      ok: false,
      exitCode,
      streamResolved: null,
      streamCandidates: null,
      engine: null,
      runtime: null,
      cacheHit: null,
      isolatedProfile: null,
      failureCodes: [],
      error: timedOut
        ? "provider smoke exceeded the 45 second deadline"
        : "provider smoke did not emit parseable JSON",
      rawStdout: stdout.trim().slice(0, 2_000),
      rawStderr: stderr.trim().slice(0, 2_000),
    };
    return { ...result, healthClass: classifyProviderHealth(result, { timedOut, harness: true }) };
  }

  const streamProbe =
    parsed.streamProbe && typeof parsed.streamProbe === "object" ? parsed.streamProbe : null;
  const result = {
    provider: entry.provider,
    media: entry.media,
    fixture: entry.fixture,
    ok: exitCode === 0 && parsed.ok === true,
    exitCode,
    streamResolved: booleanOrNull(parsed.streamResolved),
    streamCandidates: numberOrNull(parsed.streamCandidates),
    engine: stringOrNull(parsed.engine),
    runtime: stringOrNull(parsed.runtime),
    cacheHit: booleanOrNull(parsed.cacheHit),
    isolatedProfile: booleanOrNull(parsed.isolatedProfile),
    failureCodes: stringArray(parsed.failureCodes),
    failureMessages: stringArray(parsed.failureMessages),
    resolveDurationMs: numberOrNull(parsed.resolveDurationMs),
    streamReachable: booleanOrNull(parsed.streamReachable),
    streamProbeStatus: stringOrNull(parsed.streamProbeStatus ?? streamProbe?.status),
    streamProbeReason: stringOrNull(
      (typeof streamProbe?.reason === "string" ? streamProbe.reason : null) ??
        (typeof parsed.streamProbe === "string" ? parsed.streamProbe : null),
    ),
    selectedSourceLabel: stringOrNull(parsed.selectedSourceLabel),
    probeOrderLabels: stringArray(parsed.probeOrderLabels),
    score: parseScore(parsed.score),
    ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
    ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    ...(typeof parsed.stage === "string" ? { stage: parsed.stage } : {}),
    ...(found?.source === "stderr" ? { parsedFrom: "stderr" } : {}),
  };
  return {
    ...result,
    healthClass: classifyProviderHealth(result, { timedOut, harness: false }),
  };
}

function redactMatrixReport(report) {
  return {
    ...report,
    results: report.results.map((result) => {
      const { rawStdout: _rawStdout, rawStderr: _rawStderr, ...rest } = result;
      return {
        ...rest,
        error: typeof rest.error === "string" ? redactVolatileText(rest.error) : rest.error,
      };
    }),
  };
}

function redactVolatileText(value) {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "https://REDACTED")
    .replace(/\/tmp\/[^\s"']+/gi, "/tmp/REDACTED");
}

async function runLiveSmoke(command) {
  // `error` can be followed by `close`; `finish` deliberately makes that race idempotent.
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: appRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 45_000);
    const finish = (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) stderr += error instanceof Error ? error.message : String(error);
      resolve({ stdout, stderr, exitCode: exitCode ?? 1, timedOut });
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => finish(1, error));
    child.once("close", (code) => finish(code));
  });
}
