import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMDX } from "fumadocs-mdx/next";

const appDir = dirname(fileURLToPath(import.meta.url));
/** Monorepo root. `docs/` MDX is compiled from here at build time. */
const monorepoRoot = join(appDir, "../..");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // fumadocs-mdx loads source.config via dynamic import(url.href); keep it out of
  // the server bundle so webpack cache analysis does not warn on that expression.
  serverExternalPackages: ["fumadocs-mdx", "esbuild"],
  // Without this, Next infers the trace root from the nearest lockfile. On a
  // Vercel project whose Root Directory is `apps/docs` that inference can land
  // on the app instead of the workspace, and the workspace files the build
  // itself reads (docs/ MDX, the `@kunai/design` workspace package) drop out.
  outputFileTracingRoot: monorepoRoot,
  // No outputFileTracingIncludes: nothing is read at request time any more.
  // `.release/*.json`, `docs/`, and the OG mascot are baked into
  // `lib/generated-*.json` by `scripts/sync-repo-content.ts`, and every route
  // that used to read them is `force-static`.
  //
  // No outputFileTracingExcludes either. They existed because the removed
  // `lib/repo-root.ts` probed the filesystem with a computed path, so the
  // tracer gave up and pulled the whole workspace into every function. With the
  // probe gone the tracer follows real imports and the excludes have nothing
  // left to exclude — keeping them would only hide the next regression.
  async redirects() {
    return [
      // `/telemetry` was the old name for this page. In Kunai, "telemetry" means
      // local mpv playback state; the opt-in phone-home is "analytics".
      { source: "/telemetry", destination: "/analytics", permanent: true },
    ];
  },
};

const withMDX = createMDX({
  configPath: "source.config.ts",
});

export default withMDX(config);
