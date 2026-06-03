import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "../../docs",
  docs: {
    files: ["users/**/*.{md,mdx}", "developer/**/*.{md,mdx}"],
  },
  meta: {
    files: ["meta.json", "users/meta.json", "developer/meta.json"],
  },
});

export default defineConfig({});
