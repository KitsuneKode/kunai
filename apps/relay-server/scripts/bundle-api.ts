import { rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Bundles the Vercel handlers from `src/api/` into `api/` as self-contained
 * `.js` files. Runs as the `buildCommand` in `vercel.json`, before Vercel's
 * own function builders package the generated `api/` tree — so git-connected
 * builds and `vercel build` produce identical output.
 *
 * Required because `@kunai/relay` and `@kunai/providers` resolve to raw
 * TypeScript source (`exports: "./src/index.ts"`): Vercel's nft-traced
 * functions keep those imports unbundled and crash at runtime. Bundling here
 * replaces what `vercel build`'s own handlers left dangling.
 *
 * Everything under `api/` is generated and gitignored — never edit it. If a
 * handler is added, move its source under `src/api/` and extend `HANDLERS`.
 */

const appRoot = join(import.meta.dir, "..");
const apiDir = join(appRoot, "api");

const HANDLERS = [
  {
    entrypoint: join(appRoot, "src", "api", "health.ts"),
    outdir: apiDir,
  },
  {
    entrypoint: join(appRoot, "src", "api", "rpc", "[providerId].ts"),
    outdir: join(apiDir, "rpc"),
  },
] as const;

// `api/` is fully generated — wipe it so renamed handlers cannot go stale.
await rm(apiDir, { recursive: true, force: true });

for (const handler of HANDLERS) {
  const result = await Bun.build({
    entrypoints: [handler.entrypoint],
    outdir: handler.outdir,
    target: "node",
    format: "esm",
    packages: "bundle",
    sourcemap: "external",
    naming: "[name].[ext]",
    minify: false,
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

console.log(`Bundled ${HANDLERS.length} handlers into ${apiDir}.`);
