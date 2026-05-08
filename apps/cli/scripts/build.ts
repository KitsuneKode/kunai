#!/usr/bin/env bun
// Build script for @kitsunekode/kunai.
//
// Bundles src/main.ts into a single dist/kunai.js.
// Workspace packages (@kunai/*) are inlined for a compact direct-provider CLI.
// WASM assets (e.g. VidKing's module1_patched.wasm) are handled automatically
// by Bun's bundler when it encounters new URL('./...', import.meta.url) references.
// The mpv Lua bridge is copied separately since it is a runtime file path, not a JS import.

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const ENTRY = join(ROOT, "src/main.ts");
const BIN = join(DIST, "kunai.js");

const clean = process.argv.includes("--clean");

type Asset = {
  label: string;
  from: string;
  to: string;
  required?: boolean;
};

const assets: Asset[] = [
  {
    label: "VidKing WASM",
    from: join(ROOT, "../../packages/providers/src/vidking/assets/module1_patched.wasm"),
    to: join(DIST, "assets/module1_patched.wasm"),
    required: true,
  },
  {
    label: "mpv Lua bridge",
    from: join(ROOT, "assets/mpv/kunai-bridge.lua"),
    to: join(DIST, "assets/mpv/kunai-bridge.lua"),
    required: true,
  },
];

async function copyAsset(asset: Asset): Promise<void> {
  if (!existsSync(asset.from)) {
    const message = `[build] ${asset.label} not found at ${asset.from}`;

    if (asset.required) {
      throw new Error(message);
    }

    console.warn(`warn: ${message}`);
    return;
  }

  await mkdir(dirname(asset.to), { recursive: true });
  await copyFile(asset.from, asset.to);

  console.log(`[build] copied ${asset.label}`);
}

async function main(): Promise<void> {
  const start = Date.now();

  await rm(DIST, { recursive: true, force: true });

  if (clean) {
    console.log("[build] cleaned dist/");
    return;
  }

  if (!existsSync(ENTRY)) {
    throw new Error(`[build] missing CLI entry: ${ENTRY}`);
  }

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: DIST,

    target: "bun",
    format: "esm",
    splitting: false,

    /**
     * Bundle local workspace packages like:
     * @kunai/core, @kunai/providers, @kunai/storage,
     * @kunai/schemas, @kunai/types, etc.
     */
    packages: "bundle",

    naming: {
      entry: "kunai.js",
      chunk: "[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },

    sourcemap: "none",
    minify: false,

    /**
     * IMPORTANT:
     * Do not add `banner: "#!/usr/bin/env bun\n"` here.
     * src/main.ts already has the shebang.
     * Adding a banner creates a double-shebang syntax error.
     */
  });

  if (!result.success) {
    console.error("[build] Bun build failed");

    for (const log of result.logs) {
      console.error(log);
    }

    process.exit(1);
  }

  if (!existsSync(BIN)) {
    console.error("[build] Build succeeded but dist/kunai.js was not created.");
    console.error("[build] Bun outputs:");

    for (const output of result.outputs) {
      console.error(`- ${output.path}`);
    }

    process.exit(1);
  }

  for (const asset of assets) {
    await copyAsset(asset);
  }

  await chmod(BIN, 0o755);

  const ms = Date.now() - start;
  const sizeKb = (Bun.file(BIN).size / 1024).toFixed(0);

  console.log(`[build] dist/kunai.js ${sizeKb} KB (${ms}ms)`);
}

await main();
