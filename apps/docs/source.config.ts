import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

export const docs = defineDocs({
  dir: "../../docs",
  docs: {
    files: ["index.mdx", "users/**/*.{md,mdx}", "developer/**/*.{md,mdx}"],
  },
  meta: {
    files: ["meta.json", "users/meta.json", "developer/meta.json"],
  },
});

export default defineConfig({
  plugins: [lastModified()],
});
