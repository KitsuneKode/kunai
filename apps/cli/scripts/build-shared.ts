// Shared Bun.build configuration for the CLI, used by both:
//   - scripts/build.ts          (npm bundle → dist/kunai.js)
//   - scripts/build-binaries.ts (compiled single-file binaries → dist/bin/*)
//
// Keeping release stubs, defines, and graph guards in one place avoids drift
// between the two outputs (a previous bug: `bun build --compile` could not
// resolve `react-devtools-core` because it lacked the bundle's stub plugin).
import { join } from "node:path";

import type { BunPlugin } from "bun";

export type BunBuildMetafile = NonNullable<Awaited<ReturnType<typeof Bun.build>>["metafile"]>;
export type BunBuildOptions = NonNullable<Parameters<typeof Bun.build>[0]>;

export const CLI_ENTRY = "src/main.ts";
export const NPM_BUNDLE_OUT = "dist/kunai.js";

/**
 * Ink can optionally load `react-devtools-core` when `process.env.DEV` is truthy.
 * Release builds must not require that debug-only package, so we alias it to a
 * local no-op stub. `root` is the CLI package root (the dir containing src/).
 */
export function reactDevtoolsStubPlugin(root: string): BunPlugin {
  const stub = join(root, "src/infra/build/react-devtools-core-stub.ts");
  return {
    name: "kunai-release-stubs",
    setup(build) {
      build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: stub }));
    },
  };
}

/** Compile-time defines shared by every release artifact. */
export const RELEASE_DEFINE: Record<string, string> = {
  // Pin Ink's optional devtools path off in release builds.
  "process.env.DEV": '"false"',
  // Let React and any small env-gated branches take their production path.
  "process.env.NODE_ENV": '"production"',
};

/**
 * Paths that must never appear in a published bundle graph. The metafile guard
 * runs after every release build so tests, experiments, and planning docs cannot
 * leak into npm or compiled binaries even if an import regresses.
 */
const RELEASE_FORBIDDEN_INPUT_MARKERS: readonly string[] = [
  "/test/",
  "/tests/",
  ".test.",
  ".spec.",
  "/__tests__/",
  "/test/harness/",
  "/test/vhs/",
  "/test/live/",
  "/test/templates/",
  "/test/__captures__/",
  "/apps/experiments/",
  "/archive/legacy/",
  "/.plans/",
  "/.prototypes/",
];

/** Options shared by npm bundles and compiled binaries. */
export function releaseBuildBaseOptions(
  root: string,
): Pick<
  BunBuildOptions,
  "target" | "define" | "drop" | "env" | "plugins" | "metafile" | "tsconfig"
> {
  return {
    target: "bun",
    define: RELEASE_DEFINE,
    // Keep console.* for CLI output; strip only debugger statements.
    drop: ["debugger"],
    // Kunai reads KUNAI_* and other process.env at runtime — never inline the
    // build machine's environment into published artifacts.
    env: "disable",
    plugins: [reactDevtoolsStubPlugin(root)],
    metafile: true,
    tsconfig: join(root, "tsconfig.json"),
  };
}

/** Bun.build options for the published npm bundle (dist/kunai.js). */
export function npmBundleBuildOptions(
  root: string,
  options: { readonly minify: boolean },
): BunBuildOptions {
  return {
    ...releaseBuildBaseOptions(root),
    entrypoints: [join(root, CLI_ENTRY)],
    outdir: join(root, "dist"),
    format: "esm",
    splitting: false,
    // Inline workspace @kunai/* packages and runtime npm deps into one artifact.
    packages: "bundle",
    naming: {
      entry: "kunai.js",
      chunk: "[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    sourcemap: "none",
    minify: options.minify,
    /**
     * IMPORTANT:
     * Do not add `banner: "#!/usr/bin/env bun\n"` here.
     * src/main.ts already has the shebang.
     * Adding a banner creates a double-shebang syntax error.
     */
  };
}

/** Bun.build options for a single compiled binary target. */
export function compileBinaryBuildOptions(
  root: string,
  target: { readonly triple: string; readonly outfile: string },
): BunBuildOptions {
  return {
    ...releaseBuildBaseOptions(root),
    entrypoints: [join(root, CLI_ENTRY)],
    sourcemap: "none",
    minify: true,
    // `autoloadBunfig` must stay false: when true, compiled executables boot as the
    // Bun CLI (bun --version, bun upgrade, …) instead of running the entrypoint.
    compile: {
      target: target.triple,
      outfile: target.outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
  } as BunBuildOptions;
}

export function forbiddenReleaseInputs(metafile: BunBuildMetafile): readonly string[] {
  return Object.keys(metafile.inputs)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => {
      const comparable = path.startsWith("/") ? path : `/${path}`;
      return RELEASE_FORBIDDEN_INPUT_MARKERS.some((marker) => comparable.includes(marker));
    })
    .sort();
}

export function requireBuildMetafile(metafile: BunBuildMetafile | undefined): BunBuildMetafile {
  if (!metafile) {
    throw new Error("[build] Bun did not return a metafile even though metafile: true was set");
  }
  return metafile;
}

export function assertNoForbiddenReleaseInputs(metafile: BunBuildMetafile): void {
  const forbidden = forbiddenReleaseInputs(metafile);
  if (forbidden.length === 0) return;

  throw new Error(
    [
      "[build] release bundle pulled non-production inputs into the graph:",
      ...forbidden.slice(0, 20).map((path) => `- ${path}`),
      forbidden.length > 20 ? `- ... ${forbidden.length - 20} more` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function topReleaseInputs(
  metafile: BunBuildMetafile,
  limit = 12,
): readonly { readonly path: string; readonly bytes: number }[] {
  return Object.entries(metafile.inputs)
    .map(([path, input]) => ({ path, bytes: input.bytes }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, limit);
}

/** Human-readable size for build logs (KiB with one decimal under 10 MiB). */
export function formatBuildSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function totalMetafileInputBytes(metafile: BunBuildMetafile): number {
  return Object.values(metafile.inputs).reduce((sum, input) => sum + input.bytes, 0);
}

/** Soft guard for the published npm JS bundle (excludes dist/assets). */
export const NPM_BUNDLE_BUDGET_KB = 2_560;

export function assertNpmBundleBudget(bytes: number): void {
  const budgetBytes = NPM_BUNDLE_BUDGET_KB * 1024;
  if (bytes <= budgetBytes) return;
  throw new Error(
    `[build] dist/kunai.js is ${formatBuildSize(bytes)} (budget ${NPM_BUNDLE_BUDGET_KB} KiB). ` +
      `Run KUNAI_BUILD_ANALYZE=1 bun run build to inspect top inputs.`,
  );
}

export type BuildSizeRow = {
  readonly label: string;
  readonly bytes: number;
};

export function printBuildSizeTable(rows: readonly BuildSizeRow[], header: string): void {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map((row) => row.label.length), header.length);
  console.log(`[build] ${header}`);
  for (const row of rows) {
    console.log(`[build]   ${row.label.padEnd(width)}  ${formatBuildSize(row.bytes)}`);
  }
}

/** Parse `--jobs N` or `KUNAI_BUILD_JOBS` (default 2 for binary cross-compiles). */
export function resolveBuildConcurrency(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): number {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--jobs") {
      const jobsArg = argv[i + 1];
      if (jobsArg !== undefined) {
        const parsed = Number.parseInt(jobsArg, 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
  }
  const fromEnv = Number.parseInt(env.KUNAI_BUILD_JOBS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 2;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from<R>({ length: items.length });
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}
