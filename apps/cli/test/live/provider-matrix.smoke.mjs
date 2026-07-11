/* oxlint-disable promise/no-multiple-resolved -- child error and close can both fire; finish is idempotent. */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MATRIX = [
  {
    provider: "videasy",
    command: ["bun", "-e", "await import('./test/live/videasy-bloodhounds.smoke.ts')"],
    media: "series",
    fixture: "Bloodhounds S01E02",
  },
  {
    provider: "rivestream",
    command: ["bun", "-e", "await import('./test/live/rivestream-breakingbad.smoke.ts')"],
    media: "series",
    fixture: "Breaking Bad S01E01",
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
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        generatedAt: new Date().toISOString(),
        selectedProviders: selected.map((entry) => entry.provider),
        summary: {
          total: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
        },
        results,
      },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
}

async function runMatrixEntry(entry) {
  const { stdout, stderr, exitCode, timedOut } = await runLiveSmoke(entry.command);
  const parsed = parseJsonPayload(stdout);
  if (!parsed) {
    return {
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
  }

  return {
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
    ...(typeof parsed.error === "string" ? { error: parsed.error } : {}),
  };
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

function parseJsonPayload(stdout) {
  try {
    const value = JSON.parse(stdout);
    return value && typeof value === "object" ? value : null;
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const value = JSON.parse(stdout.slice(start, end + 1));
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
