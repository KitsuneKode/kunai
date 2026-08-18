import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMDX } from "fumadocs-mdx/next";

const appDir = dirname(fileURLToPath(import.meta.url));
/** Monorepo root. Pages read `docs/`, `.release/`, and `.reference/` from here. */
const monorepoRoot = join(appDir, "../..");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // fumadocs-mdx loads source.config via dynamic import(url.href); keep it out of
  // the server bundle so webpack cache analysis does not warn on that expression.
  serverExternalPackages: ["fumadocs-mdx", "esbuild"],
  // Without this, Next infers the trace root from the nearest lockfile. On a
  // Vercel project whose Root Directory is `apps/docs` that inference can land
  // on the app instead of the workspace, and the repo files these pages read
  // (docs/, .release/, .reference/) drop out of the deployed bundle.
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    // `.release/*.json` is read with readdirSync, which static tracing cannot
    // see. ISR revalidation of these routes re-runs on the server, so the
    // artifacts have to ship with the function.
    "/releases": ["../../.release/*.json"],
    "/releases/[tag]": ["../../.release/*.json"],
    "/sitemap.xml": ["../../.release/*.json"],
    "/llms.txt": ["../../.release/*.json"],
  },
  outputFileTracingExcludes: {
    // `repo-root.ts` probes the filesystem with a computed path, so the tracer
    // gives up and pulls the whole workspace into every function (1,618 files
    // from apps/cli alone, measured on 0.3.0). None of it is reachable from the
    // docs runtime. `packages/` stays — `@kunai/design` is a real dependency.
    "**": [
      "../cli/**",
      "../analytics-ingest/**",
      "../relay-server/**",
      "../../scripts/**",
      "../../test/**",
      "../../.archive/**",
      "../../.plans/**",
      "../../.prototypes/**",
    ],
  },
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
