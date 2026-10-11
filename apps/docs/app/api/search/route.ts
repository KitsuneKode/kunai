import { source } from "@/lib/source";
import { createSearchAPI } from "fumadocs-core/search/server";

export const dynamic = "force-static";
export const revalidate = false;

/**
 * `staticGET`, not `GET`.
 *
 * `GET` answers one `?query=` per request, which cannot work behind
 * `force-static`: Next prerenders the route once at build time with no query,
 * caches that response, and every later search receives the same empty array.
 * The built payload was literally two bytes — `[]` — so the dialog opened,
 * fetched, and had nothing to show for any term.
 *
 * `staticGET` exports the whole index as one cacheable file instead, and
 * `staticClient` on the other end downloads it and searches in the browser.
 * That is the shape a statically generated docs site wants: no function
 * invocation per keystroke, and it works wherever the files are served from.
 */
export const { staticGET: GET } = createSearchAPI("advanced", {
  language: "english",
  indexes: source.getPages().map((page) => {
    const data = page.data.structuredData;
    // MDX tables and inline-code-only blocks emit identical `contents` entries —
    // 13 rows that all say just "mpv". Each becomes its own search result, so a
    // query for the term floods the dialog with duplicates that carry no
    // context. Dedupe by content within the page; the first occurrence keeps
    // its heading association, which is the best anchor anyway.
    const seen = new Set<string>();
    const contents = data.contents.filter((entry) => {
      if (seen.has(entry.content)) return false;
      seen.add(entry.content);
      return true;
    });
    return {
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      id: page.url,
      structuredData: { ...data, contents },
    };
  }),
});
