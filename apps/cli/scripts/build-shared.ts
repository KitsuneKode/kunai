// Shared Bun.build configuration for the CLI, used by both:
//   - scripts/build.ts          (development app bundle → dist/kunai.js, plus
//                                public package path dist/npm-launcher.mjs staged
//                                at dist/npm/dist/npm-launcher.mjs)
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
 * Plain Node ESM launcher source and its local compatibility output. The public
 * launcher is copied separately to `dist/npm/dist/npm-launcher.mjs`; its exact
 * optional platform packages carry the compiled binaries. Bundling this file is
 * what introduced `bun:` imports and made npm installs require a separate Bun.
 */
export const NPM_LAUNCHER_ENTRY = "scripts/npm-launcher.mjs";
export const NPM_LAUNCHER_OUT = "dist/kunai.mjs";

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
  "/.reference/experiments/",
  "/.archive/legacy/",
  "/.plans/",
  "/.prototypes/",
];

/** Options shared by the development app bundle and compiled platform binaries. */
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

/** Bun.build options for the unpublished development app bundle (dist/kunai.js). */
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

/**
 * Soft guard for the bundled JS build (excludes dist/assets).
 *
 * This bundle is no longer what npm ships. The generated public package carries
 * `dist/npm-launcher.mjs` and `LICENSE`; its exact optional dependencies are
 * separate platform packages containing compiled binaries. This remains a bloat
 * ratchet on the dev/`start` bundle, not a constraint on npm install size.
 *
 * Raised from 2_560 when the half-block poster renderer landed: decoding JPEG
 * in process costs ~55 KiB but is what makes posters work on Windows, where
 * `chafa` is effectively never installed. Raised from 2_688 on 2026-07-22, which
 * the build had reached to the byte (2688.24 KiB), when the restart-required
 * notification kind and the extracted auto-update gate landed. Headroom is
 * deliberate — this should only move for a decision like those, with the reason
 * recorded here.
 *
 * Raised from 2_720 on 2026-07-26, which the build had again reached to the
 * byte (2721 KiB), for the title-control menu work: episode navigation on the
 * loading surface, the poster carried through to the preview pane, and
 * context-aware row labels/glyphs. Note this budget guards the *development*
 * bundle only — `dist/kunai.js` is not published. The public package is the
 * Node launcher (`files: ["dist/npm-launcher.mjs", "LICENSE", "README.md"]`,
 * ~9 KiB) and is ratcheted separately by NPM_PACK_PACKED_BUDGET_BYTES /
 * NPM_PACK_UNPACKED_BUDGET_BYTES, so moving this number cannot affect what a
 * user installs from npm.
 *
 * Raised from 2_800 on 2026-08-13 for the release-hardening provider work
 * plus the verified offline media/sidecar provenance handoff and active
 * cancellation/reconnect generation guards. `main` had only 388 bytes of
 * headroom before those changes. The added provider code is diagnostics and
 * bounded-cache machinery: endpoint-aware pipe decoding, a curl truncation
 * guard, strict catalog-id parsing, captcha classification that replaces a
 * silent empty result, and TTL cache size bounds. The step restores real
 * headroom rather than clearing one change.
 *
 * Raised from 2_880 on 2026-08-23 for the launch-flag and discovery fixes:
 * a loading branch on the idle surface (a bootstrap `-S` search renders before
 * any browse shell exists, so it had no loader), the `not-applicable` update
 * status that stops telling package-manager installs their updates are
 * "disabled", adoption of the resolved catalog name over the `-i` placeholder,
 * and `discoverItemLimit` finally reaching the `/random` tray. `main` had 1.3
 * KiB of headroom, so any one of these would have tripped it. Deleting the dead
 * `mixRandomCandidatePools` export paid some of it back. The step restores real
 * headroom rather than clearing one change.
 *
 * The Discord IPC containment branch originally needed a proposed 2_888 KiB
 * step before those launch fixes landed: it measured 2,952,099 bytes, 4,065
 * above its 2,948,034-byte base. The host binary grew by 4,096 bytes and gzip
 * -9 by 94 bytes. After integrating the current main branch, the combined
 * development bundle is 2,953,713 bytes, 36,367 below main's existing 2_920
 * KiB cap. Discord containment therefore does not raise the final ratchet.
 * This budget still applies only to the unpublished development bundle.
 *
 * Raised from 2_920 on 2026-08-25 for the native release train. `main` measured
 * 2,988,548 bytes against the 2,990,080-byte cap -- 1.5 KiB of headroom, so the
 * next change of any size was going to trip it regardless of what that change
 * was.
 *
 * The whole remaining train was measured rather than the one PR that failed:
 * building its tip (#183, containing #184, #204, #182 and #183) against its
 * base gives 2,983,756 vs 2,967,004 bytes -- 16,752 bytes, 16.4 KiB. Nearly all
 * of it is #184 alone (16,747 bytes measured separately); #204, #182 and #183
 * are installer scripts, release workflows and attestation, which never enter
 * the CLI graph. The 16.4 KiB is ordinary feature code: archive-aware rollback,
 * version metadata, and the install/uninstall/upgrade paths that consume
 * verified archives.
 *
 * 2_976 leaves ~41 KiB after the train lands, which restores real headroom
 * rather than clearing one change. The security/reliability PRs still queued
 * behind it are small bounded fixes and will be measured on their own terms if
 * they ever approach this number again.
 *
 * Raised from 2_976 on 2026-08-26 for provider-native episode identity (#178).
 * After chain A landed, `main` measured 3,044,391 bytes against the 3,047,424
 * (2_976 KiB) cap -- only 3.0 KiB of headroom, so the next feature of any size
 * was going to trip it. #178 measures 3,051,960 bytes: a 7,569-byte (7.4 KiB)
 * step that threads provider-native episode identity through the
 * playback->storage->offline->provider pipeline -- new identity types, a schema
 * field, two storage migrations, and plumbing across ResolveWorkLedger,
 * SourceInventoryService, OfflineAssetService, and the AllManga adapter. It is
 * distributed feature code with no single blob and no duplication (verified
 * against the analyzer). 3_000 leaves ~19.6 KiB of headroom, restoring real
 * slack rather than clearing one change; #206/#207 are measured on their own
 * terms if they ever approach this number.
 *
 * Raised from 3_000 on 2026-08-27 for the YouTube live/quality train (#283 on
 * top of #282). `fix/release-smoke-ux-030` alone measures 3,069,897 bytes
 * against the 3,072,000 (3_000 KiB) cap -- 2.1 KiB of headroom, so the stacked
 * PR was going to trip it no matter how small. The two together measure
 * 3,073,808 bytes: a 3,911-byte step for live-stream playback, the extractor-args
 * parser that replaced a regex, PO-token plumbing, Shorts shape, and the browse
 * metadata rows. Two rounds of deduplication were applied first (one live-status
 * label instead of three ternary chains, one preview-fact builder instead of five
 * conditional spreads) and recovered ~300 bytes; the rest is distributed feature
 * code with no single blob. 3_048 leaves ~46 KiB of headroom, restoring real
 * slack rather than clearing one change.
 *
 * Raised from 3_048 to 3_056 on 2026-09-01 after Google Cast playback was
 * rebased over main. The resulting development bundle measures 3,124,396 bytes:
 * the 3_048 KiB ratchet was exceeded by 3,244 bytes after adding the Cast V2
 * client, LAN gateways, subtitle conversion, and split-output coordinator.
 * 3_056 leaves 4,948 bytes of measured headroom while keeping the ratchet tight.
 *
 * Worth restating because it is what makes this safe: this number guards
 * `dist/kunai.js`, which is published nowhere and is not the source of the
 * compiled binaries either -- `compileBinaryBuildOptions` compiles from
 * `src/main.ts`. What a user installs from npm is the ~9 KiB launcher, held by
 * NPM_PACK_PACKED_BUDGET_BYTES / NPM_PACK_UNPACKED_BUDGET_BYTES, which this
 * change does not touch and which the exact-tarball verification added in #166
 * has since made stricter.
 */
export const NPM_BUNDLE_BUDGET_KB = 3_056;

/** Packed-size ratchet for the public Node launcher manifest, script, and license. */
export const NPM_PACK_PACKED_BUDGET_BYTES = 32 * 1024;

/** Unpacked-size ratchet for the public Node launcher manifest, script, and license. */
export const NPM_PACK_UNPACKED_BUDGET_BYTES = 64 * 1024;

const NPM_PACK_ALLOWED_PATHS = new Set([
  "dist/npm-launcher.mjs",
  "LICENSE",
  "README.md",
  "package.json",
]);

/**
 * Files the published tarball MUST contain. The launcher is `bin`, so shipping
 * without it means `kunai` resolves to nothing on a real install. The readme is
 * the package page npm renders; omitting it publishes a blank listing.
 */
const NPM_PACK_REQUIRED_PATHS: readonly string[] = [
  "package.json",
  "dist/npm-launcher.mjs",
  "LICENSE",
  "README.md",
];

/** Returns required tarball paths that are missing from the given listing. */
export function missingRequiredNpmPackPaths(paths: readonly string[]): readonly string[] {
  const present = new Set(paths.map((path) => path.replace(/\\/g, "/")));
  return NPM_PACK_REQUIRED_PATHS.filter((required) => !present.has(required));
}

/** Returns a human-readable reason when a tarball path must not ship on npm. */
export function forbiddenNpmPackPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("dist/bin/") || normalized.includes("/dist/bin/")) {
    return "compiled binaries must not ship on npm (use GitHub Releases)";
  }
  if (normalized.endsWith(".meta.json") || normalized.includes("/.meta.json")) {
    return "build analyze metafiles must not ship on npm";
  }
  if (normalized === "dist/build-meta.json") {
    return "build metafiles must not ship on npm";
  }
  if (NPM_PACK_ALLOWED_PATHS.has(normalized)) {
    return null;
  }
  return `path is not in the npm files allowlist: ${normalized}`;
}

export function assertNpmPackContents(paths: readonly string[]): void {
  const violations = paths
    .map((path) => ({ path, reason: forbiddenNpmPackPath(path) }))
    .filter((entry): entry is { path: string; reason: string } => entry.reason !== null);
  if (violations.length > 0) {
    const detail = violations.map((entry) => `  - ${entry.path}: ${entry.reason}`).join("\n");
    throw new Error(`[pkg:check] npm pack includes forbidden paths:\n${detail}`);
  }

  const missing = missingRequiredNpmPackPaths(paths);
  if (missing.length > 0) {
    const detail = missing.map((path) => `  - ${path}`).join("\n");
    throw new Error(`[pkg:check] npm pack is missing required files:\n${detail}`);
  }
}

export function assertNpmPackBudgets(packedBytes: number, unpackedBytes: number): void {
  if (packedBytes > NPM_PACK_PACKED_BUDGET_BYTES) {
    throw new Error(
      `[pkg:check] packed tarball is ${formatBuildSize(packedBytes)} ` +
        `(budget ${formatBuildSize(NPM_PACK_PACKED_BUDGET_BYTES)}).`,
    );
  }
  if (unpackedBytes > NPM_PACK_UNPACKED_BUDGET_BYTES) {
    throw new Error(
      `[pkg:check] unpacked tarball is ${formatBuildSize(unpackedBytes)} ` +
        `(budget ${formatBuildSize(NPM_PACK_UNPACKED_BUDGET_BYTES)}).`,
    );
  }
}

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
