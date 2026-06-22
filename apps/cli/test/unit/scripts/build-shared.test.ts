import { describe, expect, test } from "bun:test";

import {
  assertNoForbiddenReleaseInputs,
  assertNpmBundleBudget,
  forbiddenReleaseInputs,
  formatBuildSize,
  mapWithConcurrency,
  compileBinaryBuildOptions,
  npmBundleBuildOptions,
  releaseBuildBaseOptions,
  requireBuildMetafile,
  resolveBuildConcurrency,
  topReleaseInputs,
  type BunBuildMetafile,
} from "../../../scripts/build-shared";

function metafile(inputs: readonly string[]): BunBuildMetafile {
  return {
    inputs: Object.fromEntries(inputs.map((input) => [input, { bytes: 1, imports: [] }])),
    outputs: {},
  } as BunBuildMetafile;
}

describe("release build shared guards", () => {
  test("allows production source graph inputs", () => {
    const graph = metafile(["src/main.ts", "../../packages/providers/src/videasy/direct.ts"]);

    expect(forbiddenReleaseInputs(graph)).toEqual([]);
    expect(() => assertNoForbiddenReleaseInputs(graph)).not.toThrow();
  });

  test("rejects tests experiments plans prototypes and legacy imports in release graphs", () => {
    const graph = metafile([
      "src/main.ts",
      "test/unit/provider.test.ts",
      "test/harness/render-capture.ts",
      "test/vhs/setup.tape",
      "test/live/provider.smoke.ts",
      "apps/experiments/scratchpads/probe.ts",
      "archive/legacy/apps/cli/src/providers/old.ts",
      ".plans/runtime-note.md",
      ".prototypes/harness/server.js",
    ]);

    expect(forbiddenReleaseInputs(graph)).toEqual([
      ".plans/runtime-note.md",
      ".prototypes/harness/server.js",
      "apps/experiments/scratchpads/probe.ts",
      "archive/legacy/apps/cli/src/providers/old.ts",
      "test/harness/render-capture.ts",
      "test/live/provider.smoke.ts",
      "test/unit/provider.test.ts",
      "test/vhs/setup.tape",
    ]);
    expect(() => assertNoForbiddenReleaseInputs(graph)).toThrow("non-production inputs");
  });

  test("requires Bun to return a metafile when the release build requests one", () => {
    expect(() => requireBuildMetafile(undefined)).toThrow("did not return a metafile");
  });

  test("ranks metafile inputs by byte size", () => {
    const graph = metafile(["src/small.ts", "src/large.ts"]);
    graph.inputs["src/small.ts"] = { bytes: 10, imports: [] };
    graph.inputs["src/large.ts"] = { bytes: 100, imports: [] };

    expect(topReleaseInputs(graph, 1)).toEqual([{ path: "src/large.ts", bytes: 100 }]);
  });
});

describe("release build shared options", () => {
  const root = "/repo/apps/cli";

  test("keeps runtime env resolution disabled for published artifacts", () => {
    expect(releaseBuildBaseOptions(root).env).toBe("disable");
    expect(releaseBuildBaseOptions(root).drop).toEqual(["debugger"]);
  });

  test("bundles workspace packages for the npm artifact", () => {
    expect(npmBundleBuildOptions(root, { minify: true }).packages).toBe("bundle");
    expect(npmBundleBuildOptions(root, { minify: true }).format).toBe("esm");
    expect(npmBundleBuildOptions(root, { minify: false }).minify).toBe(false);
  });

  test("disables bunfig autoload for compiled binaries", () => {
    const compile = compileBinaryBuildOptions(root, {
      triple: "bun-linux-x64",
      outfile: "/tmp/kunai",
    }).compile as { autoloadBunfig?: boolean; autoloadDotenv?: boolean };
    expect(compile.autoloadBunfig).toBe(false);
    expect(compile.autoloadDotenv).toBe(false);
  });

  test("formats build sizes for logs", () => {
    expect(formatBuildSize(512)).toBe("512 B");
    expect(formatBuildSize(2048)).toBe("2.0 KiB");
    expect(formatBuildSize(5 * 1024 * 1024)).toBe("5.0 MiB");
  });

  test("resolves binary build concurrency from argv and env", () => {
    expect(resolveBuildConcurrency(["--jobs", "4"])).toBe(4);
    expect(resolveBuildConcurrency([], { KUNAI_BUILD_JOBS: "3" })).toBe(3);
    expect(resolveBuildConcurrency([])).toBe(2);
  });

  test("runs mapWithConcurrency in bounded parallelism", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active -= 1;
      return value * 2;
    });
    expect(out).toEqual([2, 4, 6, 8]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test("enforces npm bundle budget", () => {
    expect(() => assertNpmBundleBudget(1024)).not.toThrow();
    expect(() => assertNpmBundleBudget(3_000_000)).toThrow("budget");
  });
});
