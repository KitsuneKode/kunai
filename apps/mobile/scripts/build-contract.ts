import { join, resolve } from "node:path";

const MOBILE_ROOT = resolve(import.meta.dir, "..");

export type MobileTargetId = "android-termux-node" | "ios-ashell";

export type MobileTarget = {
  readonly id: MobileTargetId;
  readonly runtime: "android" | "ashell";
  readonly output: string;
};

export const MOBILE_TARGETS: readonly MobileTarget[] = [
  {
    id: "android-termux-node",
    runtime: "android",
    output: "android/kunai-mobile-android.mjs",
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

export type MobileArtifactSetMetadata = {
  readonly target: MobileTargetId;
  readonly artifacts: readonly string[];
  readonly sha256: string;
};

export type MobileBuildMetadata = {
  readonly schemaVersion: 2;
  readonly version: string;
  readonly targets: readonly MobileTarget[];
  readonly artifacts: readonly MobileArtifactMetadata[];
  readonly artifactSets: readonly MobileArtifactSetMetadata[];
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

const ANDROID_FORBIDDEN_INPUT_MARKERS = [
  "bun:",
  "/runtime/ashell/",
  "/apps/cli/",
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
  "Buffer",
  "Bun.",
  "node:",
  "bun:",
] as const;

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

export function findForbiddenAndroidInputs(metafile: MobileBuildMetafile): readonly string[] {
  return Object.keys(metafile.inputs)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => {
      const comparable = path.startsWith("/") ? path.toLowerCase() : `/${path.toLowerCase()}`;
      return ANDROID_FORBIDDEN_INPUT_MARKERS.some((marker) => comparable.includes(marker));
    })
    .sort();
}

export function findForbiddenAndroidOutputTokens(source: string): readonly string[] {
  const violations: string[] = [];
  if (/\bBun\b/u.test(source)) violations.push("Bun");
  if (source.includes("bun:")) violations.push("bun:");
  return violations;
}

export function findForbiddenIosProcessUses(
  sources: Readonly<Record<string, string>>,
): readonly string[] {
  const violations: string[] = [];
  for (const [rawPath, source] of Object.entries(sources)) {
    const path = rawPath.replaceAll("\\", "/");
    if (/\bprocess\b/u.test(source)) violations.push(path);
  }
  return violations.sort();
}

export function findForbiddenIosOutputTokens(source: string): readonly string[] {
  const violations: string[] = IOS_FORBIDDEN_OUTPUT_TOKENS.filter((token) =>
    source.includes(token),
  );
  if (/\bprocess\b/u.test(source)) violations.push("process");
  return violations.sort();
}

export async function waitForMobileHostProof(
  completion: Promise<void>,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} did not complete`)), timeoutMs);
  });
  try {
    await Promise.race([completion, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
