// Shared Bun build configuration for the CLI, used by both:
//   - scripts/build.ts          (npm bundle → dist/kunai.js)
//   - scripts/build-binaries.ts (compiled single-file binaries → dist/bin/*)
//
// Keeping the release stubs + defines in one place avoids drift between the two
// outputs (a previous bug: a CLI `bun build --compile` could not resolve
// `react-devtools-core` because it lacked the bundle's stub plugin).
import { join } from "node:path";

import type { BunPlugin } from "bun";

export type BunBuildMetafile = NonNullable<Awaited<ReturnType<typeof Bun.build>>["metafile"]>;

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

const RELEASE_FORBIDDEN_INPUT_MARKERS: readonly string[] = [
  "/test/",
  "/tests/",
  ".test.",
  ".spec.",
  "/__tests__/",
  "/apps/experiments/",
  "/archive/legacy/",
  "/.plans/",
];

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
