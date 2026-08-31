import { join, resolve } from "node:path";

const MOBILE_ROOT = resolve(import.meta.dir, "..");

export type MobileTargetId = "android-arm64" | "android-x64" | "ios-ashell";

export type MobileTarget = {
  readonly id: MobileTargetId;
  readonly runtime: "android" | "ashell";
  readonly output: string;
  readonly compileTarget?: "bun-linux-arm64-android" | "bun-linux-x64-android";
};

export const MOBILE_TARGETS: readonly MobileTarget[] = [
  {
    id: "android-arm64",
    runtime: "android",
    output: "kunai-mobile-android-arm64",
    compileTarget: "bun-linux-arm64-android",
  },
  {
    id: "android-x64",
    runtime: "android",
    output: "kunai-mobile-android-x64",
    compileTarget: "bun-linux-x64-android",
  },
  {
    id: "ios-ashell",
    runtime: "ashell",
    output: "ios/kunai-mobile-ios.js",
  },
] as const;

export type MobileBuildMetafile = {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs?: Readonly<Record<string, unknown>>;
};

export type MobileArtifactMetadata = {
  readonly path: string;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly sha256: string;
};

export type MobileBuildMetadata = {
  readonly schemaVersion: 1;
  readonly version: string;
  readonly targets: readonly MobileTarget[];
  readonly artifacts: readonly MobileArtifactMetadata[];
};

const IOS_FORBIDDEN_INPUT_MARKERS = [
  "node:",
  "bun:",
  "/runtime/android/",
  "/node_modules/ink/",
  "/node_modules/react/",
  "sqlite",
  "/.archive/legacy/",
  "/.reference/experiments/",
  "/test/",
  "/.plans/",
] as const;

const IOS_FORBIDDEN_OUTPUT_TOKENS = [
  "import(",
  "require(",
  "process.env",
  "process.cwd",
  "process.exit",
  "process.versions",
  "Buffer",
  "Bun.",
  "node:",
  "bun:",
] as const;

const ASHELL_COMPOSITION_SUFFIX = "src/runtime/ashell/composition.ts";
const AUDITED_PROCESS_LOOKUP = "(globalThis as { process?: unknown }).process";

export function resolveRuntimeModule(targetId: MobileTargetId): string {
  const target = MOBILE_TARGETS.find((candidate) => candidate.id === targetId);
  if (!target) throw new Error(`Unknown mobile target: ${targetId}`);
  return join(MOBILE_ROOT, "src", "runtime", target.runtime, "composition.ts");
}

export function findForbiddenIosInputs(metafile: MobileBuildMetafile): readonly string[] {
  return Object.keys(metafile.inputs)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => {
      const comparable = path.startsWith("/") ? path.toLowerCase() : `/${path.toLowerCase()}`;
      return IOS_FORBIDDEN_INPUT_MARKERS.some((marker) => comparable.includes(marker));
    })
    .sort();
}

export function findForbiddenIosProcessUses(
  sources: Readonly<Record<string, string>>,
): readonly string[] {
  const violations: string[] = [];
  for (const [rawPath, source] of Object.entries(sources)) {
    const path = rawPath.replaceAll("\\", "/");
    const hasAuditedLookup = source.includes(AUDITED_PROCESS_LOOKUP);
    const remaining = source.replaceAll(AUDITED_PROCESS_LOOKUP, "");
    const hasDirectProcessUse = /\bprocess\s*(?:\.|\[)/u.test(remaining);
    if (hasDirectProcessUse || (hasAuditedLookup && !path.endsWith(ASHELL_COMPOSITION_SUFFIX))) {
      violations.push(path);
    }
  }
  return violations.sort();
}

export function findForbiddenIosOutputTokens(source: string): readonly string[] {
  return IOS_FORBIDDEN_OUTPUT_TOKENS.filter((token) => source.includes(token)).sort();
}
