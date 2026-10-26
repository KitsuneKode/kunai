import path from "node:path";

import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

import { createDocLastModified } from "./scripts/doc-last-modified";

let readLastModified: ReturnType<typeof createDocLastModified> | undefined;
async function lastModifiedFromHistory(file: string) {
  readLastModified ??= createDocLastModified(path.resolve(process.cwd(), "../.."));
  return readLastModified(file);
}

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
  plugins: [lastModified({ versionControl: lastModifiedFromHistory })],
});
