import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RELEASE_BINARY_TARGETS } from "@/services/update/platform-assets";

const CLI_ROOT = join(import.meta.dirname, "../..");
const BUILD_SCRIPT = join(CLI_ROOT, "scripts/build-binaries.ts");

function runFakeBuild(
  preload: string,
  outputDirectory: string,
  marker: string,
  args: readonly string[] = [],
): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync({
    cmd: [
      process.execPath,
      "--preload",
      preload,
      BUILD_SCRIPT,
      "--output-directory",
      outputDirectory,
      "--jobs",
      "2",
      ...args,
    ],
    cwd: CLI_ROOT,
    env: {
      ...process.env,
      CI: "",
      KUNAI_FAKE_BINARY_MARKER: marker,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function manifestNames(directory: string, manifest: string): readonly string[] {
  return readFileSync(join(directory, manifest), "utf8")
    .trim()
    .split("\n")
    .map((row) => row.slice(66));
}

describe("build-binaries incremental subprocess", () => {
  test("all-target then --only reconciles every retained archive/raw pair", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "kunai-build-binaries-subprocess-"));
    const outputDirectory = join(fixtureRoot, "output with spaces");
    const preload = join(fixtureRoot, "fake-bun-build.mjs");
    writeFileSync(
      preload,
      `Bun.build = async (options) => {
  const outfile = options?.compile?.outfile;
  if (typeof outfile !== "string") throw new Error("fake compiler requires compile.outfile");
  const name = outfile.split(/[\\\\/]/).at(-1);
  await Bun.write(outfile, \`${"${process.env.KUNAI_FAKE_BINARY_MARKER}"}:\${name}\\n\`);
  return {
    success: true,
    logs: [],
    outputs: [],
    metafile: { inputs: { "src/main.ts": { bytes: 32 } }, outputs: {} },
  };
};
`,
    );

    try {
      const all = runFakeBuild(preload, outputDirectory, "all");
      expect(all.exitCode, all.stderr?.toString() ?? "").toBe(0);

      const incremental = runFakeBuild(preload, outputDirectory, "only", ["--only", "linux-x64"]);
      expect(incremental.exitCode, incremental.stderr?.toString() ?? "").toBe(0);
      expect(incremental.stdout?.toString() ?? "").toContain(
        "wrote 1 binaries; reconciled 8 archive/raw target pairs + 2 manifests",
      );

      expect(readdirSync(outputDirectory).sort()).toEqual(
        [
          ...RELEASE_BINARY_TARGETS.flatMap((target) => [target.out, target.archiveName]),
          "SHA256SUMS",
          "SHA256SUMS.archives",
        ].sort(),
      );
      expect(manifestNames(outputDirectory, "SHA256SUMS")).toEqual(
        RELEASE_BINARY_TARGETS.map((target) => target.out).sort(),
      );
      expect(manifestNames(outputDirectory, "SHA256SUMS.archives")).toEqual(
        RELEASE_BINARY_TARGETS.map((target) => target.archiveName).sort(),
      );
      expect(readFileSync(join(outputDirectory, "kunai-linux-x64"), "utf8")).toBe(
        "only:kunai-linux-x64\n",
      );
      expect(readFileSync(join(outputDirectory, "kunai-darwin-arm64"), "utf8")).toBe(
        "all:kunai-darwin-arm64\n",
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
