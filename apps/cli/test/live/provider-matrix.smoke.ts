import { fileURLToPath } from "node:url";

type MatrixProviderId = "videasy" | "rivestream" | "allanime" | "miruro";

type MatrixEntry = {
  readonly provider: MatrixProviderId;
  readonly command: readonly string[];
  readonly media: "series" | "anime";
  readonly fixture: string;
};

type MatrixResult = {
  readonly provider: MatrixProviderId;
  readonly media: MatrixEntry["media"];
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
  readonly error?: string;
  readonly rawStdout?: string;
  readonly rawStderr?: string;
};

const MATRIX: readonly MatrixEntry[] = [
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
];

const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const requested = new Set(process.argv.slice(1).map((arg) => arg.toLowerCase()));
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
  process.exit(1);
}

const results: MatrixResult[] = [];
for (const entry of selected) {
  results.push(await runMatrixEntry(entry));
}

const failed = results.filter((result) => !result.ok);
const payload = {
  ok: failed.length === 0,
  generatedAt: new Date().toISOString(),
  selectedProviders: selected.map((entry) => entry.provider),
  summary: {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
  },
  results,
};

console.log(JSON.stringify(payload, null, 2));
if (failed.length > 0) {
  process.exit(1);
}

async function runMatrixEntry(entry: MatrixEntry): Promise<MatrixResult> {
  const child = Bun.spawn([...entry.command], {
    cwd: appRoot,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
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
      error: "provider smoke did not emit parseable JSON",
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

function parseJsonPayload(stdout: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(stdout) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const value = JSON.parse(stdout.slice(start, end + 1)) as unknown;
      return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
