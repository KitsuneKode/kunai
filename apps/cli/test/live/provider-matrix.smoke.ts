/**
 * Serial provider matrix: run every production provider's focused smoke once
 * and emit a single JSON report.
 *
 * Report shaping (payload parsing, health classification) lives in
 * ./provider-matrix-report.ts so it can be unit-tested without the network.
 */
import { join, resolve } from "node:path";

import { isJsonNumber, isJsonObject, isJsonString, type JsonValue } from "@kunai/types";

import {
  classifyProviderHealth,
  parseSmokePayload,
  type ProviderHealthClass,
} from "./provider-matrix-report";

type MatrixEntry = {
  readonly provider: string;
  readonly command: readonly string[];
  readonly media: string;
  readonly fixture: string;
  /**
   * Command that also decodes frames in mpv. Its payload is a superset of the
   * normal smoke's, so playback mode simply swaps the command.
   */
  readonly playbackCommand?: readonly string[];
};

const MATRIX: readonly MatrixEntry[] = [
  {
    provider: "videasy",
    command: ["bun", "test/live/videasy-bloodhounds.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "videasy"],
    media: "series",
    fixture: "Dutton Ranch S01E01 (Neon Phase A)",
  },
  {
    provider: "rivestream",
    command: ["bun", "-e", "await import('./test/live/rivestream-breakingbad.smoke.ts')"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "rivestream"],
    media: "series",
    fixture: "Breaking Bad S01E01",
  },
  {
    provider: "vidlink",
    command: ["bun", "test/live/vidlink-inception.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "vidlink"],
    media: "movie",
    fixture: "Inception (DASH + playlist cookie)",
  },
  {
    provider: "vidrock",
    command: ["bun", "test/live/vidrock-breakingbad.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "vidrock"],
    media: "series",
    fixture: "Breaking Bad S01E01 (AES-GCM lanes)",
  },
  {
    provider: "movy",
    command: ["bun", "test/live/movy-residentevil.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "movy"],
    media: "movie",
    fixture: "Resident Evil (STREAMCRYPTO lanes)",
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
    provider: "hianime",
    command: ["bun", "test/live/hianime-naruto.smoke.ts"],
    media: "anime",
    fixture: "Naruto E01 sub+dub (ZokoAnime embed)",
  },
  {
    provider: "animekai",
    command: ["bun", "test/live/animekai-naruto.smoke.ts"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "animekai"],
    media: "anime",
    fixture: "Naruto E01 sub+dub (AES-CBC embed sources)",
  },
  {
    provider: "animegg",
    command: ["bun", "test/live/animegg-deathnote.smoke.ts"],
    media: "anime",
    fixture: "Death Note E05 (mpv decode — probes lie)",
  },
  {
    provider: "kickassanime",
    command: ["bun", "test/live/kickassanime-frieren.smoke.ts"],
    media: "anime",
    fixture: "Frieren E05 (mpv decode — probes lie)",
  },
  {
    provider: "youtube",
    command: ["bun", "-e", "await import('./test/live/youtube.smoke.ts')"],
    playbackCommand: ["bun", "test/live/mpv-playback.smoke.ts", "youtube"],
    media: "youtube",
    fixture: "Me at the zoo (jNQXAC9IVRw)",
  },
];

const SMOKE_DEADLINE_MS = 45_000;
/**
 * `healthy` normally means resolved and reachable, which is not the same as
 * playable — Rivestream passed for weeks on a stream mpv could not open. With
 * this set, providers that support it decode real frames instead, and the row
 * carries the mpv verdict.
 */
function playbackModeEnabled(): boolean {
  return process.env.KUNAI_MATRIX_PLAYBACK === "1";
}
const appRoot = join(import.meta.dir, "../..");

// Default movie/series/anime release evidence uses ReleaseProviderSignoff
// (apps/cli/test/live/release-provider-signoff.smoke.ts), not this full matrix.
// Opt-in: KUNAI_LIVE_RELEASE_SIGNOFF=1 bun run test:live:release-signoff
// Workflow: provider-matrix.yml mode=release-signoff → release-provider-signoff-<run_id>
const argv = process.argv.slice(2);

if (argv.some((arg) => arg.toLowerCase() === "release-signoff")) {
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
  const requested = new Set(argv.map((arg) => arg.toLowerCase()));
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
    const results: MatrixResult[] = [];
    for (const entry of selected) results.push(await runMatrixEntry(entry));

    const failed = results.filter((result) => !result.ok);
    const countOf = (healthClass: ProviderHealthClass) =>
      results.filter((result) => result.healthClass === healthClass).length;
    const report = {
      ok: failed.length === 0,
      generatedAt: new Date().toISOString(),
      // What the run was asked for. Rows carry what each one actually proved,
      // because providers without a decode fixture fall back to reachability.
      requestedEvidence: playbackModeEnabled() ? "playback" : "reachability",
      selectedProviders: selected.map((entry) => entry.provider),
      summary: {
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        byClass: {
          healthy: countOf("healthy"),
          "provider-drift": countOf("provider-drift"),
          "environment-network": countOf("environment-network"),
          "harness-failure": countOf("harness-failure"),
        },
      },
      results,
    };
    console.log(JSON.stringify(report, null, 2));

    const artifactPath = matrixArtifactPath();
    if (artifactPath) {
      // Bun.write creates missing parent directories, so the artifact path can
      // point anywhere the workflow chooses.
      await Bun.write(
        resolve(artifactPath),
        `${JSON.stringify(redactMatrixReport(report), null, 2)}\n`,
      );
    }

    if (failed.length > 0) process.exitCode = 1;
  }
}

function matrixArtifactPath(): string | undefined {
  return process.env.KUNAI_MATRIX_ARTIFACT?.trim();
}

type EvidenceKind = "playback" | "reachability";

type MatrixScore = {
  readonly functional: boolean | null;
  readonly performative: boolean | null;
  readonly ordered: boolean | null;
};

type MatrixResult = {
  readonly provider: string;
  readonly media: string;
  readonly fixture: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly streamResolved: boolean | null;
  readonly streamCandidates: number | null;
  readonly engine: string | null;
  readonly runtime: string | null;
  readonly cacheHit: boolean | null;
  readonly isolatedProfile: boolean | null;
  readonly failureCodes: readonly string[];
  readonly resolveDurationMs?: number | null;
  readonly streamReachable?: boolean | null;
  readonly selectedSourceLabel?: string | null;
  readonly probeOrderLabels?: readonly string[];
  readonly score?: MatrixScore | null;
  readonly evidence: EvidenceKind;
  readonly mpv?: JsonValue;
  readonly stage?: JsonValue;
  readonly error?: string;
  readonly rawStdout?: string;
  readonly rawStderr?: string;
  readonly healthClass: ProviderHealthClass;
};

async function runMatrixEntry(entry: MatrixEntry): Promise<MatrixResult> {
  // Not every provider has a decode fixture, so a playback run is a mix. The row
  // records which command actually ran: claiming playback evidence for a
  // provider that only answered the reachability smoke is the overclaim this
  // field exists to prevent.
  const playback = playbackModeEnabled() && entry.playbackCommand !== undefined;
  const evidence: EvidenceKind = playback ? "playback" : "reachability";
  const command = playback ? (entry.playbackCommand ?? entry.command) : entry.command;
  const { stdout, stderr, exitCode, timedOut } = await runLiveSmoke(command);
  const parsed = parseSmokePayload(stdout, stderr);

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
      // SAFETY: harness-failure rows are built empty; the mutable local never
      // escapes before the row is serialized.
      failureCodes: [] as string[],
      evidence,
      error: timedOut
        ? "provider smoke exceeded the 45 second deadline"
        : "provider smoke did not emit parseable JSON",
      rawStdout: stdout.trim().slice(0, 2_000),
      rawStderr: stderr.trim().slice(0, 2_000),
    };
    return {
      ...result,
      healthClass: classifyProviderHealth(result, { timedOut, harness: true }),
    };
  }

  // An early-exit smoke reports through `reason`; the resolve path uses
  // `error`. Both are provider evidence, so the row carries whichever exists.
  const reason = stringOrNull(parsed.reason);
  const error = stringOrNull(parsed.error) ?? reason;

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
    resolveDurationMs: numberOrNull(parsed.resolveDurationMs),
    streamReachable: booleanOrNull(parsed.streamReachable),
    selectedSourceLabel: stringOrNull(parsed.selectedSourceLabel),
    probeOrderLabels: stringArray(parsed.probeOrderLabels),
    score: parseScore(parsed.score),
    evidence,
    ...(parsed.mpv === undefined ? null : { mpv: parsed.mpv }),
    ...(stringOrNull(parsed.stage) === null ? null : { stage: parsed.stage }),
    ...(error === null ? null : { error }),
  };

  return {
    ...result,
    healthClass: classifyProviderHealth(result, { timedOut }),
  };
}

function redactMatrixReport<T extends { readonly results: readonly MatrixResult[] }>(report: T) {
  return {
    ...report,
    results: report.results.map((result) => {
      const { rawStdout: _rawStdout, rawStderr: _rawStderr, ...rest } = result;
      return {
        ...rest,
        error: isJsonString(rest.error) ? redactVolatileText(rest.error) : rest.error,
      };
    }),
  };
}

function redactVolatileText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "https://REDACTED")
    .replace(/\/tmp\/[^\s"']+/gi, "/tmp/REDACTED");
}

async function runLiveSmoke(command: readonly string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}> {
  const child = Bun.spawn([...command], {
    cwd: appRoot,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  // setTimeout, not Bun.sleep: the deadline has to be cancellable when the
  // smoke finishes first, or the matrix waits 45s on every healthy provider.
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, SMOKE_DEADLINE_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, exitCode: exitCode ?? 1, timedOut };
  } finally {
    clearTimeout(deadline);
  }
}

function booleanOrNull<T>(value: T): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function numberOrNull<T>(value: T): number | null {
  return isJsonNumber(value) && Number.isFinite(value) ? value : null;
}

function stringOrNull<T>(value: T): string | null {
  return isJsonString(value) ? value : null;
}

function stringArray<T>(value: T): string[] {
  return Array.isArray(value) ? value.filter(isJsonString) : [];
}

function parseScore<T>(value: T): MatrixScore | null {
  if (!isJsonObject(value)) return null;
  return {
    functional: booleanOrNull(value.functional),
    performative: booleanOrNull(value.performative),
    ordered: booleanOrNull(value.ordered),
  };
}
