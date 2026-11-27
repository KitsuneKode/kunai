// Shared Bun.build configuration for the CLI, used by both:
//   - scripts/build.ts          (development app bundle → dist/kunai.js, plus
//                                public package path dist/npm-launcher.mjs staged
//                                at dist/npm/dist/npm-launcher.mjs)
//   - scripts/build-binaries.ts (compiled single-file binaries → dist/bin/*)
//
// Keeping release stubs, defines, and graph guards in one place avoids drift
// between the two outputs (a previous bug: `bun build --compile` could not
// resolve `react-devtools-core` because it lacked the bundle's stub plugin).
import { statSync } from "node:fs";
import { join, resolve } from "node:path";

import { isJsonString } from "@kunai/types";
import type { BunPlugin } from "bun";

import releaseKey from "../src/services/update/release-key.json";

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

/**
 * Runtime consumers of the CLI manifest read only its version. A default JSON
 * import otherwise retains the entire manifest, including development scripts
 * and dependency lists. Project just this manifest for both release outputs;
 * other package.json imports keep their ordinary JSON-loader behavior.
 */
function cliVersionManifestPlugin(root: string): BunPlugin {
  return {
    name: "kunai-cli-version-manifest",
    setup(build) {
      // Follow aliases and compare filesystem identity. Path spellings can
      // differ across Windows junctions, short names, symlinks and hard links.
      const manifest = statSync(resolve(root, "package.json"), { bigint: true });
      build.onLoad({ filter: /package\.json$/ }, async ({ path }) => {
        const loaded = statSync(path, { bigint: true });
        if (loaded.dev !== manifest.dev || loaded.ino !== manifest.ino) return;
        const { version } = await Bun.file(path).json();
        if (!isJsonString(version) || version.length === 0) {
          throw new Error("[build] CLI package.json must contain a non-empty version");
        }
        return { contents: JSON.stringify({ version }), loader: "json" };
      });
    },
  };
}

/**
 * Keep the unpublished dev bundle slim: Android handoff DASH parsing pulls in
 * `@xmldom/xmldom`, which is large but already a declared runtime dependency.
 * `bun run start` resolves it from node_modules; compiled binaries still bundle
 * it because this plugin is npm-bundle-only.
 */
function npmBundleExternalDependencyPlugin(): BunPlugin {
  return {
    name: "kunai-npm-bundle-externals",
    setup(build) {
      build.onResolve({ filter: /^@xmldom\/xmldom$/ }, () => ({
        path: "@xmldom/xmldom",
        external: true,
      }));
    },
  };
}

/** Compile-time define map shared by every release artifact. */
interface ReleaseDefineMap {
  readonly [key: string]: string;
}

/** Compile-time defines shared by every release artifact. */
export const RELEASE_DEFINE: ReleaseDefineMap = {
  "import.meta.kunaiReleasePublicKey": JSON.stringify(releaseKey.ed25519Spki),
  // Pin Ink's optional devtools path off in release builds.
  "process.env.DEV": '"false"',
  // Let React and any small env-gated branches take their production path.
  "process.env.NODE_ENV": '"production"',
};

/** `RELEASE_DEFINE` plus build-time opt-ins read from the build environment. */
export function releaseDefine(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReleaseDefineMap {
  return {
    ...RELEASE_DEFINE,
    ...bundledTmdbKeyDefine(env.KUNAI_TMDB_BUILD_KEY),
    ...smokeReleaseKeyDefine(env.KUNAI_SMOKE_RELEASE_KEY_SPKI, env.GITHUB_WORKFLOW),
  };
}

/**
 * CI installer smoke builds embed a throwaway Ed25519 key instead of the release
 * pin, so the mock release can sign its manifests and the binary's upgrade path
 * is exercised with signatures on. The Release workflow refuses it outright, the
 * variable is part of turbo's build:binaries hash, and verify-release-binaries
 * checks a full release build still carries the pin.
 */
export function smokeReleaseKeyDefine(
  spki: string | undefined,
  workflow: string | undefined,
): ReleaseDefineMap {
  const trimmed = spki?.trim();
  if (!trimmed) return {};
  if (workflow === "Release") {
    throw new Error(
      "KUNAI_SMOKE_RELEASE_KEY_SPKI is for smoke builds; the Release workflow must not set it",
    );
  }
  if (!/^[A-Za-z0-9+/]{59}=$/.test(trimmed)) {
    throw new Error("KUNAI_SMOKE_RELEASE_KEY_SPKI must be a base64 Ed25519 SPKI (60 characters)");
  }
  return { "import.meta.kunaiReleasePublicKey": JSON.stringify(trimmed) };
}

/**
 * Kunai's own TMDB key, inlined only when release CI sets KUNAI_TMDB_BUILD_KEY.
 * Explicit opt-in: `env: "disable"` still keeps every other build-machine
 * variable out of published artifacts. Without it the runtime falls back to a
 * user key or the legacy key (`resolveTmdbApiKey`).
 */
export function bundledTmdbKeyDefine(key: string | undefined): ReleaseDefineMap {
  const trimmed = key?.trim();
  if (!trimmed || !/^[A-Za-z0-9]{16,64}$/.test(trimmed)) return {};
  return { "process.env.KUNAI_BUNDLED_TMDB_API_KEY": JSON.stringify(trimmed) };
}

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
    define: releaseDefine(),
    // Keep console.* for CLI output; strip only debugger statements.
    drop: ["debugger"],
    // Kunai reads KUNAI_* and other process.env at runtime — never inline the
    // build machine's environment into published artifacts.
    env: "disable",
    plugins: [reactDevtoolsStubPlugin(root), cliVersionManifestPlugin(root)],
    metafile: true,
    tsconfig: join(root, "tsconfig.json"),
  };
}

/** Bun.build options for the unpublished development app bundle (dist/kunai.js). */
export function npmBundleBuildOptions(
  root: string,
  options: { readonly minify: boolean },
): BunBuildOptions {
  const releaseBase = releaseBuildBaseOptions(root);
  return {
    ...releaseBase,
    entrypoints: [join(root, CLI_ENTRY)],
    outdir: join(root, "dist"),
    format: "esm",
    splitting: false,
    // Inline workspace @kunai/* packages and runtime npm deps into one artifact.
    packages: "bundle",
    plugins: [...(releaseBase.plugins ?? []), npmBundleExternalDependencyPlugin()],
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

/**
 * Targets compiled with JSC bytecode by default. Measured 2026-11-24 on
 * linux-x64: shell mounted in ~220 ms instead of ~340 ms, `--help` in 0.02–0.04 s
 * instead of 0.10 s, and ~28% less memory, for ~11 MiB more per binary.
 *
 * Left out on purpose: every shipped updater refuses a binary over 128 MiB
 * (`MAX_RELEASE_BINARY_BYTES`, baked into published binaries), and bytecode
 * puts windows-x64 at 124.6 MiB and android-x64 at 129.1 MiB. Windows and
 * Android stay plain until that ceiling can move.
 */
const BYTECODE_TRIPLE = /^bun-(?:linux-(?:x64|arm64)(?:-musl)?|darwin-(?:x64|arm64))$/;

export function bytecodeByDefault(triple: string): boolean {
  return BYTECODE_TRIPLE.test(triple);
}

/**
 * `KUNAI_COMPILE_BYTECODE=1` forces bytecode on, `=0` forces it off (for A/B
 * measurement); anything else uses the per-target default.
 */
function bytecodeFor(triple: string, explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  const override = process.env.KUNAI_COMPILE_BYTECODE;
  if (override === "1") return true;
  if (override === "0") return false;
  return bytecodeByDefault(triple);
}

/** Bun.build options for a single compiled binary target. */
export function compileBinaryBuildOptions(
  root: string,
  target: { readonly triple: string; readonly outfile: string },
  options: { readonly bytecode?: boolean } = {},
): BunBuildOptions {
  const bytecode = bytecodeFor(target.triple, options.bytecode);
  // SAFETY: target.triple is a validated ReleaseBinaryTarget triple; Bun's CompileTarget union is narrower than string.
  const base = {
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
  if (bytecode) {
    return { ...base, bytecode: true, format: "esm" };
  }
  return base;
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
  const byOutputBytes = new Map<string, number>();
  for (const output of Object.values(metafile.outputs ?? {})) {
    for (const [path, info] of Object.entries(output.inputs ?? {})) {
      byOutputBytes.set(path, (byOutputBytes.get(path) ?? 0) + info.bytesInOutput);
    }
  }
  if (byOutputBytes.size > 0) {
    return [...byOutputBytes.entries()]
      .map(([path, bytes]) => ({ path, bytes }))
      .sort((left, right) => right.bytes - left.bytes)
      .slice(0, limit);
  }
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
 * The Android terminal handoff slice was measured independently before that
 * upstream raise. Its fixed base measured 3,067,451 bytes, leaving only 4,549
 * bytes below the old cap. The branch measured 3,078,331 bytes: a 10,880-byte
 * (10.6 KiB) increase for the player-choice/capability model, stream
 * qualification, Android intent adapter, and detached session routing. The
 * release metafile attributed 16,540 source bytes to those new modules before
 * bundling; there was no new dependency or opaque asset. Its proposed 3_020 KiB
 * ratchet was superseded by main's independently justified 3_048 KiB cap, so
 * the Android slice does not raise the ratchet again.
 *
 * Raised from 3_048 to 3_096 on 2026-10-13 for the Android DASH gateway.
 * Identical minified build options with only stream-gateway.ts overridden to
 * 7b16a00eb measured 3,050,925 bytes; the XML parser, DASH addressing and
 * template routes, and bounded manifest-prefix detection measured 3,151,920
 * bytes (+100,995, 98.6 KiB). The new cap leaves 18 KiB of headroom. The
 * public npm launcher pack budgets below are unchanged.
 *
 * Raised from 3_096 to 3_100 on 2026-10-15 for the combined reviewed
 * corrections (#622, #652, #659-#662) on main@beca2fb51. Identical minified
 * options measured 3,171,033 bytes, 729 above the old limit. Removing the
 * duplicated subtitle attachment and language-normalization branches reduced
 * this to 3,170,828 bytes (-205); the remaining 524 bytes are distributed
 * runtime changes, not a new dependency or asset. The 4 KiB adjustment leaves
 * 3,572 bytes of headroom for that measured tree. Public npm pack budgets are
 * unchanged; this ratchet still rejects the first byte beyond its new limit.
 *
 * Worth restating because it is what makes this safe: this number guards
 * `dist/kunai.js`, which is published nowhere and is not the source of the
 * compiled binaries either -- `compileBinaryBuildOptions` compiles from
 * `src/main.ts`. What a user installs from npm is the ~9 KiB launcher, held by
 * NPM_PACK_PACKED_BUDGET_BYTES / NPM_PACK_UNPACKED_BUDGET_BYTES, which this
 * change does not touch and which the exact-tarball verification added in #166
 * has since made stricter.
 */
// October 22 provider/timing/consent/mouse integration measured 3,185,739 bytes.
// November 6 dependency alignment measured 3,195,955 bytes.
// November 19 Jikan fallback, Android local-file gateway, sub/dub source cycling,
// and Termux onboarding additions measured 3,205,426 bytes.
// November 24 Ink 8 + dependency refresh measured 3,202,977 bytes.
// November 24 six-review fixes (#731) measured 3,210,160 bytes — 80 bytes left.
// November 24 PlaybackPhase split into stage modules (plan 012) measured
// 3,218,128 bytes: +7,968, all property names at the new typed stage
// boundaries, which minification cannot shorten. No dependency or asset.
// Merged onto the #740 dead-code prune (providers, aliases, CLI exports), the
// split measured 3,212,126 bytes: -6,002 against the split alone.
// November 24 plain/screen-reader mode across app-shell surfaces plus light and
// high-contrast themes measured 3,224,652 bytes (+21,675).
// November 24 streaming relay cap, locked manifest reset, registered toast
// timer, and unread-body cancels measured 3,210,429 bytes.
// The split merged with #733, #736 and the #740 prune measured 3,211,074 bytes.
// Plain mode merged with the PlaybackPhase split (#741) and #705 measured
// 3,228,630 bytes.
// Merged Stremio addon hardening (strict direct-media probe, mpv file-local
// confinement, guarded subtitle localization, addon stdin) measured
// 3,247,553 bytes on the merged tree.
// 3172 KiB leaves 575 bytes; public launcher budgets below are unchanged.
// Stremio review fixes measured 3,250,495 bytes (strict media evidence,
// request identity, and playback/config guards); 3175 KiB leaves 705 bytes.
// Addon beta safety fixes measured 3,253,277 bytes; 3178 KiB leaves 995 bytes.
// After merging main and making addons opt-in, Bun 1.4.5 measured 3,270,431
// bytes. With #734, #745, #744, and the fail-closed prompt, it measured
// 3,290,941 bytes. 3215 KiB leaves 1,219 bytes; public launcher budgets are unchanged.
// Merged onto main after #737 (nested-secret vaulting, shared deadline
// combiner), it measured 3,293,492 bytes. 3219 KiB leaves 2,764 bytes; public
// launcher budgets are unchanged. The tmux graphics path measured 3,297,643
// bytes. With measured terminal cell sizing the bundle measured 3,300,575
// bytes; 3226 KiB leaves 2,849 bytes.
// Merge-train batch 1 (#750 #751 #752 #782 #753 #786 #805 #783: playback
// failover and correctness fixes) measured 3,303,435 bytes together, 11 over.
// No dependency or asset. 3227 KiB leaves 1,013 bytes. With direct Kitty
// placement for Konsole and WezTerm (#813) on top, it measured 3,304,843
// bytes; 3231 KiB leaves 3,701 bytes.
// The analytics client (v2 ping, neutral consent, ping log, release markers,
// #800) on top measured 3,313,118 bytes; 3239 KiB leaves 3,618 bytes.
// Provider DNS-over-HTTPS (#829: shared resolver, curl --resolve transport, the
// providerDns setting) on top measured 3,318,418 bytes; 3243 KiB leaves 2,414.
// The Android launcher's cancellation and output bounds (#674 slice) and its
// runtime env allowlist (#769) on top measured 3,321,113 bytes; 3245 KiB
// leaves 1,767.
// Mid-stream failover (stream-unrecoverable escalation, recovery start intent)
// and the provider-defaults revision 8 history module on top measured
// 3,323,126 bytes; 3247 KiB leaves 1,802.
// Shell-v4 narrow browse/palette/playback layout on top measured 3,327,248
// bytes, 2,320 over. Extracting the browse opener, browse display context, and
// shared screen/timestamp helpers first shrank the large shell files rather
// than copying them; the remaining growth is narrow footer density, palette row
// accounting, and playback/browse chrome policy. 3250 KiB is the smallest
// whole-KiB raise over the measured tree and leaves 752 bytes; public launcher
// budgets are unchanged.
// Tracks panel recovery grammar (wide values, pane cue, narrow section tabs,
// compact failure causes, and singleton facts) measured 3,330,345 bytes,
// 2,345 over. The shared row renderer and footer helper keep the implementation
// deduplicated; the remaining growth is explicit state copy and bounded layout
// policy. 3253 KiB is the smallest whole-KiB raise over that measurement and
// leaves 727 bytes; public launcher budgets are unchanged.
export const NPM_BUNDLE_BUDGET_KB = 3_253;

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
    `[build] dist/kunai.js is ${formatBuildSize(bytes)} (${bytes} bytes; budget ${NPM_BUNDLE_BUDGET_KB} KiB, over by ${bytes - budgetBytes} bytes). ` +
      `Run KUNAI_BUILD_ANALYZE=1 bun run build to inspect top inputs.`,
  );
}

/** Default compiled standalone binary size ceiling (MiB, includes embedded Bun runtime). */
export const COMPILED_BINARY_BUDGET_MIB = 120;

/**
 * Per-target compiled binary ceilings (MiB), enforced by build-binaries.
 * Measured 2026-11-24 (Bun 1.4.4) plus ~3.5 MiB headroom, bytecode where
 * {@link bytecodeByDefault}: darwin-arm64 99.8, darwin-x64 108.3, linux-x64
 * 118.7, linux-arm64 118.8, linux-x64-musl 112.6, linux-arm64-musl 111.6;
 * plain: windows-x64 113.4, windows-arm64 99.0, android-arm64 112.6,
 * android-x64 117.8. Every value stays under the 128 MiB ceiling shipped
 * updaters enforce. Raising one is a deliberate edit with a new measurement.
 */
export const COMPILED_BINARY_BUDGET_MIB_BY_TARGET = new Map([
  ["darwin-arm64", 104],
  ["darwin-x64", 112],
  ["linux-arm64", 122],
  ["linux-arm64-musl", 115],
  ["linux-x64", 122],
  ["linux-x64-musl", 116],
  ["android-arm64", 116],
  ["android-x64", 121],
  ["windows-x64", 117],
  ["windows-arm64", 103],
]);

export function compiledBinaryBudgetMib(targetId: string): number {
  return COMPILED_BINARY_BUDGET_MIB_BY_TARGET.get(targetId) ?? COMPILED_BINARY_BUDGET_MIB;
}

export function assertCompiledBinaryBudget(targetId: string, bytes: number): void {
  const budgetMib = compiledBinaryBudgetMib(targetId);
  const budgetBytes = budgetMib * 1024 * 1024;
  if (bytes <= budgetBytes) return;
  throw new Error(
    `[binaries] ${targetId} is ${formatBuildSize(bytes)} (${bytes} bytes; budget ${budgetMib} MiB, over by ${bytes - budgetBytes} bytes). ` +
      `Run bun run scripts/build-binaries.ts --only ${targetId} --analyze to inspect top inputs.`,
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
