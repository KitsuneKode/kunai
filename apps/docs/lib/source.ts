import { docs } from "@/.source/server";
import { loader } from "fumadocs-core/source";
import type { StaticSource } from "fumadocs-core/source";
import { lucideIconsPlugin } from "fumadocs-core/source/plugins/lucide-icons";

type GeneratedSource = ReturnType<typeof docs.toFumadocsSource>;
type PageDataOf<F> = F extends { type: "page"; data: infer D } ? D : never;
type MetaDataOf<F> = F extends { type: "meta"; data: infer D } ? D : never;
type DocsSourceConfig = {
  pageData: PageDataOf<GeneratedSource["files"][number]>;
  metaData: MetaDataOf<GeneratedSource["files"][number]>;
};

export const source = loader({
  baseUrl: "/docs",
  // SAFETY: `docs.toFumadocsSource()` is typed against fumadocs-mdx's nested
  // copy of fumadocs-core; bun's isolated install gives this app a nominally
  // distinct copy, so `loader`'s `infer` cannot recover the page-data shape
  // across the boundary and `page.data` collapses to bare `PageData`.
  // Re-anchor the same runtime object to this workspace's `StaticSource`
  // declaration.
  source: docs.toFumadocsSource() as StaticSource<DocsSourceConfig>,
  plugins: [
    // SAFETY: `lucideIconsPlugin()` is declared against the default storage
    // generic and fumadocs 16.15.x made `plugins` storage-invariant, so it no
    // longer assigns directly. It only rewrites icon names into component
    // refs, so pinning the type is safe.
    lucideIconsPlugin() as never,
  ],
});
