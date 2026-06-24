import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // fumadocs-mdx loads source.config via dynamic import(url.href); keep it out of
  // the server bundle so webpack cache analysis does not warn on that expression.
  serverExternalPackages: ["fumadocs-mdx", "esbuild"],
};

const withMDX = createMDX({
  configPath: "source.config.ts",
});

export default withMDX(config);
