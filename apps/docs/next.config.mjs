import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  typescript: {
    // Turborepo runs `bun tsc --noEmit` as the docs type gate. Keeping Next's
    // worker out of this step avoids duplicate typechecking and a noisy worker
    // exit on Bun/TS 6 while preserving the explicit package task.
    ignoreBuildErrors: true,
  },
};

const withMDX = createMDX({
  configPath: "source.config.ts",
});

export default withMDX(config);
