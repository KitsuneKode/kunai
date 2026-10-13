import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";

import { llmsMarkdownOptions } from "./lib/llm-markdown";

export const docs = defineDocs({
  dir: "../../docs",
  docs: {
    files: ["index.mdx", "users/**/*.{md,mdx}", "developer/**/*.{md,mdx}"],
    // Keeps a stringified-Markdown copy of every page on `page.data` so
    // llms-full.txt and the per-page .md endpoint can serve it without
    // re-reading the filesystem at request time. `llmsMarkdownOptions` is how
    // generated components (provider table, doc-hub cards) serialize as real
    // Markdown instead of leaking raw JSX.
    postprocess: { includeProcessedMarkdown: llmsMarkdownOptions },
  },
  meta: {
    files: ["meta.json", "users/meta.json", "developer/meta.json"],
  },
});

export default defineConfig({
  plugins: [lastModified()],
});
