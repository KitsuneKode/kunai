#!/usr/bin/env bun

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { BunPlugin } from "bun";

import {
  findForbiddenIosInputs,
  findForbiddenIosOutputTokens,
  findForbiddenIosProcessUses,
  MOBILE_TARGETS,
  type MobileArtifactMetadata,
  type MobileBuildMetafile,
  type MobileBuildMetadata,
  type MobileTarget,
  resolveRuntimeModule,
} from "./build-contract";

const MOBILE_ROOT = resolve(import.meta.dir, "..");
const REPOSITORY_ROOT = resolve(MOBILE_ROOT, "../..");
const ENTRYPOINT = join(MOBILE_ROOT, "src/entry.ts");
const DIST = join(MOBILE_ROOT, "dist");
const IOS_DIST = join(DIST, "ios");
const ASHELL_SCRIPTS = join(MOBILE_ROOT, "scripts/ashell");
const IOS_HELPERS = [
  "kunai-mobile",
  "kunai-mobile-http",
  "kunai-mobile-open-vlc",
  "kunai-mobile-read-line",
] as const;

function mobileRuntimePlugin(runtimePath: string): BunPlugin {
  return {
    name: "kunai-mobile-runtime",
    setup(build) {
      build.onResolve({ filter: /^mobile:runtime$/ }, () => ({ path: runtimePath }));
    },
  };
}

function requireSuccessfulBuild(
  result: Awaited<ReturnType<typeof Bun.build>>,
  label: string,
): void {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  throw new Error(`[mobile-build] ${label} failed`);
}

function requireMetafile(
  result: Awaited<ReturnType<typeof Bun.build>>,
  label: string,
): MobileBuildMetafile {
  if (!result.metafile) throw new Error(`[mobile-build] ${label} returned no metafile`);
  return result.metafile;
}

async function releaseVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(join(REPOSITORY_ROOT, "apps/cli/package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("[mobile-build] release version is unavailable");
  }
  return packageJson.version;
}

async function buildAndroid(target: MobileTarget, version: string): Promise<void> {
  if (!target.compileTarget) throw new Error(`[mobile-build] ${target.id} has no compile target`);
  const outfile = join(DIST, target.output);
  const buildOptions = {
    entrypoints: [ENTRYPOINT],
    target: "bun",
    packages: "bundle",
    env: "disable",
    metafile: true,
    minify: true,
    sourcemap: "none",
    define: { __KUNAI_MOBILE_VERSION__: JSON.stringify(version) },
    plugins: [mobileRuntimePlugin(resolveRuntimeModule(target.id))],
    compile: {
      target: target.compileTarget,
      outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
  } as unknown as NonNullable<Parameters<typeof Bun.build>[0]>;
  const result = await Bun.build(buildOptions);
  requireSuccessfulBuild(result, target.id);
  requireMetafile(result, target.id);
  await chmod(outfile, 0o755);
}

async function inputSources(metafile: MobileBuildMetafile): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  for (const rawPath of Object.keys(metafile.inputs)) {
    if (!rawPath.endsWith(".ts") && !rawPath.endsWith(".tsx")) continue;
    const candidates = [rawPath, resolve(rawPath), resolve(MOBILE_ROOT, rawPath)];
    for (const path of candidates) {
      const file = Bun.file(path);
      if (!(await file.exists())) continue;
      sources[rawPath.replaceAll("\\", "/")] = await file.text();
      break;
    }
  }
  return sources;
}

async function assertIosGraph(metafile: MobileBuildMetafile): Promise<void> {
  const forbiddenInputs = findForbiddenIosInputs(metafile);
  if (forbiddenInputs.length > 0) {
    throw new Error(`[mobile-build] forbidden iOS inputs:\n${forbiddenInputs.join("\n")}`);
  }
  const forbiddenProcessUses = findForbiddenIosProcessUses(await inputSources(metafile));
  if (forbiddenProcessUses.length > 0) {
    throw new Error(
      `[mobile-build] unaudited iOS process use:\n${forbiddenProcessUses.join("\n")}`,
    );
  }
}

async function assertIosBundleRuns(bundlePath: string): Promise<void> {
  const source = await Bun.file(bundlePath).text();
  const forbiddenTokens = findForbiddenIosOutputTokens(source);
  if (forbiddenTokens.length > 0) {
    throw new Error(`[mobile-build] forbidden iOS output tokens: ${forbiddenTokens.join(", ")}`);
  }

  const host = globalThis as typeof globalThis & { jsc?: unknown };
  const previousJsc = host.jsc;
  const previousLog = console.log;
  const output: string[] = [];
  const files = new Map<string, string>();
  let completeHostProof: () => void = () => {};
  const hostProofCompleted = new Promise<void>((resolveCompletion) => {
    completeHostProof = resolveCompletion;
  });
  host.jsc = {
    readFile: (path: string) => files.get(path) ?? "",
    writeFile: (path: string, value: string) => {
      files.set(path, value);
      return 0;
    },
    isFile: (path: string) => files.has(path),
    makeFolder: () => 0,
    deleteFile: (path: string) => {
      files.delete(path);
      return 0;
    },
    move: (from: string, to: string) => {
      const value = files.get(from);
      if (value === undefined || files.has(to)) return 1;
      files.delete(from);
      files.set(to, value);
      if (to === ".runtime/exit-code") completeHostProof();
      return 0;
    },
    system: () => "0",
  };
  console.log = (...values: unknown[]) => output.push(values.map(String).join(" "));
  try {
    Function(source)();
    await hostProofCompleted;
  } finally {
    console.log = previousLog;
    if (previousJsc === undefined) delete host.jsc;
    else host.jsc = previousJsc;
  }
  if (!output.some((line) => line.includes("Usage: kunai-mobile"))) {
    throw new Error("[mobile-build] fake JSC harness did not reach mobile help output");
  }
}

async function buildIos(version: string): Promise<void> {
  const target = MOBILE_TARGETS.find((candidate) => candidate.id === "ios-ashell");
  if (!target) throw new Error("[mobile-build] iOS target is unavailable");
  const result = await Bun.build({
    entrypoints: [ENTRYPOINT],
    outdir: IOS_DIST,
    naming: "kunai-mobile-ios.js",
    target: "browser",
    format: "iife",
    splitting: false,
    packages: "bundle",
    env: "disable",
    metafile: true,
    minify: true,
    sourcemap: "none",
    define: { __KUNAI_MOBILE_VERSION__: JSON.stringify(version) },
    plugins: [mobileRuntimePlugin(resolveRuntimeModule(target.id))],
  });
  requireSuccessfulBuild(result, target.id);
  const metafile = requireMetafile(result, target.id);
  await assertIosGraph(metafile);

  for (const name of IOS_HELPERS) {
    const destination = join(IOS_DIST, name);
    await Bun.write(destination, Bun.file(join(ASHELL_SCRIPTS, name)));
    await chmod(destination, 0o755);
  }
  await assertIosBundleRuns(join(DIST, target.output));
}

async function artifactMetadata(path: string): Promise<MobileArtifactMetadata> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return {
    path: relative(DIST, path).replaceAll("\\", "/"),
    bytes: bytes.byteLength,
    gzipBytes: Bun.gzipSync(bytes).byteLength,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  };
}

async function writeMetadata(version: string): Promise<void> {
  const artifactPaths = [
    ...MOBILE_TARGETS.filter((target) => target.runtime === "android").map((target) =>
      join(DIST, target.output),
    ),
    ...[
      ...IOS_HELPERS.map((name) => join(IOS_DIST, name)),
      join(IOS_DIST, "kunai-mobile-ios.js"),
    ].sort(),
  ];
  const metadata: MobileBuildMetadata = {
    schemaVersion: 1,
    version,
    targets: MOBILE_TARGETS,
    artifacts: await Promise.all(artifactPaths.map(artifactMetadata)),
  };
  await Bun.write(join(DIST, "mobile-build-meta.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function main(): Promise<void> {
  const version = await releaseVersion();
  await rm(DIST, { recursive: true, force: true });
  await mkdir(IOS_DIST, { recursive: true });
  for (const target of MOBILE_TARGETS) {
    if (target.runtime === "android") await buildAndroid(target, version);
  }
  await buildIos(version);
  await writeMetadata(version);
  console.log(`[mobile-build] wrote ${MOBILE_TARGETS.length} targets for Kunai ${version}`);
}

await main();
