import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { link, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertNoForbiddenReleaseInputs,
  assertNpmBundleBudget,
  NPM_BUNDLE_BUDGET_KB,
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
      ".reference/experiments/scratchpads/probe.ts",
      ".archive/legacy/apps/cli/src/providers/old.ts",
      ".plans/runtime-note.md",
      ".prototypes/harness/server.js",
    ]);

    expect(forbiddenReleaseInputs(graph)).toEqual([
      ".archive/legacy/apps/cli/src/providers/old.ts",
      ".plans/runtime-note.md",
      ".prototypes/harness/server.js",
      ".reference/experiments/scratchpads/probe.ts",
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

  test("ships the local React DevTools stub used by release builds", () => {
    const cliRoot = join(import.meta.dir, "../../..");
    expect(existsSync(join(cliRoot, "src/infra/build/react-devtools-core-stub.ts"))).toBe(true);
  });

  test("keeps runtime env resolution disabled for published artifacts", () => {
    expect(releaseBuildBaseOptions(root).env).toBe("disable");
    expect(releaseBuildBaseOptions(root).drop).toEqual(["debugger"]);
  });

  test("bundles workspace packages for the npm artifact", () => {
    expect(npmBundleBuildOptions(root, { minify: true }).packages).toBe("bundle");
    expect(npmBundleBuildOptions(root, { minify: true }).format).toBe("esm");
    expect(npmBundleBuildOptions(root, { minify: false }).minify).toBe(false);
  });

  test.each(["direct", "symlinked", "hardlinked-manifest"] as const)(
    "embeds only the CLI version through a %s root, preserving other manifests and runtime env",
    async (rootKind) => {
      const sandboxRoot = await mkdtemp(join(tmpdir(), "kunai-build-manifest-"));
      const fixtureRoot = join(sandboxRoot, "project");
      const buildRoot =
        rootKind === "symlinked" ? join(sandboxRoot, "linked-project") : fixtureRoot;
      try {
        await mkdir(fixtureRoot);
        if (rootKind === "symlinked") {
          await symlink(fixtureRoot, buildRoot, process.platform === "win32" ? "junction" : "dir");
        }
        await mkdir(join(fixtureRoot, "src"));
        await mkdir(join(fixtureRoot, "other"));
        await Bun.write(join(fixtureRoot, "tsconfig.json"), "{}");
        await Bun.write(
          join(fixtureRoot, "package.json"),
          JSON.stringify({ version: "1.2.3-test", scripts: { test: "UNUSED_CLI_SCRIPT_MARKER" } }),
        );
        if (rootKind === "hardlinked-manifest") {
          await mkdir(join(fixtureRoot, "manifest-alias"));
          await link(
            join(fixtureRoot, "package.json"),
            join(fixtureRoot, "manifest-alias/package.json"),
          );
        }
        await Bun.write(
          join(fixtureRoot, "other/package.json"),
          JSON.stringify({ scripts: { test: "other manifest stays intact" } }),
        );
        await Bun.write(
          join(fixtureRoot, "src/main.ts"),
          [
            rootKind === "hardlinked-manifest"
              ? 'import cli from "../manifest-alias/package.json" with { type: "json" };'
              : 'import cli from "../package.json" with { type: "json" };',
            'import other from "../other/package.json" with { type: "json" };',
            "console.log(JSON.stringify([cli.version, other.scripts.test, process.env.KUNAI_MANIFEST_RUNTIME_TEST]));",
          ].join("\n"),
        );

        const result = await Bun.build(npmBundleBuildOptions(buildRoot, { minify: true }));
        expect(result.success).toBe(true);
        const bundle = join(fixtureRoot, "dist/kunai.js");
        const declared = statSync(join(buildRoot, "package.json"), { bigint: true });
        const imported = statSync(
          join(
            fixtureRoot,
            rootKind === "hardlinked-manifest" ? "manifest-alias/package.json" : "package.json",
          ),
          { bigint: true },
        );
        const diagnostics = JSON.stringify({
          buildRoot,
          fileIds: [`${declared.dev}:${declared.ino}`, `${imported.dev}:${imported.ino}`],
          inputs: Object.keys(requireBuildMetafile(result.metafile).inputs),
        });
        expect(await Bun.file(bundle).text(), diagnostics).not.toContain(
          "UNUSED_CLI_SCRIPT_MARKER",
        );
        const child = Bun.spawn([process.execPath, bundle], {
          env: { ...process.env, KUNAI_MANIFEST_RUNTIME_TEST: "resolved at runtime" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code).toBe(0);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout)).toEqual([
          "1.2.3-test",
          "other manifest stays intact",
          "resolved at runtime",
        ]);
      } finally {
        await rm(sandboxRoot, { recursive: true, force: true });
      }
    },
  );

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
    // Pinned on purpose: raising the ratchet has to be a deliberate edit with a
    // documented measurement in build-shared.ts, not a number that drifts up
    // whenever a bundle grows.
    expect(NPM_BUNDLE_BUDGET_KB).toBe(3_124);
    expect(() => assertNpmBundleBudget(3_198_976)).not.toThrow();
    expect(() => assertNpmBundleBudget(3_198_977)).toThrow("budget 3124 KiB");
  });
});
