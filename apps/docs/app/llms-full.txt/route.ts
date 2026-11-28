import { codeMetadata } from "@/lib/code-metadata";
import { formatDocPageMarkdown } from "@/lib/llms";
import { provenance } from "@/lib/provenance";
import { latestReleaseNotesArtifact, releasePath } from "@/lib/release-notes";
import { docsCanonicalUrl, docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET() {
  const pages = [...source.getPages()].sort((a, b) => a.url.localeCompare(b.url));
  const sections = await Promise.all(pages.map((page) => formatDocPageMarkdown(page)));
  const latestRelease = latestReleaseNotesArtifact();
  if (latestRelease) {
    sections.push(
      [
        `# Latest Published Release: ${latestRelease.title} (${latestRelease.tag})`,
        "",
        `URL: ${docsCanonicalUrl(releasePath(latestRelease.tag))}`,
        `Date: ${latestRelease.date}`,
        "",
        latestRelease.summary,
        "",
      ].join("\n"),
    );
  }

  const header = [
    "# Kunai Complete Documentation",
    "",
    `@doc-version: ${codeMetadata.cliVersion}`,
    ...(latestRelease ? [`@latest-published-version: ${latestRelease.version}`] : []),
    `@cli-source-revision: ${provenance.cliSourceRevision}`,
    `@synced-at: ${provenance.syncedAt}`,
    "",
    "> Complete Markdown documentation for Kunai, a terminal media client for anime, movies, TV series and YouTube with mpv playback, source switching, resume and offline downloads.",
    "",
    `Site: ${docsCanonicalUrl("/")}`,
    `Index: ${docsSiteUrl}/llms.txt`,
    "",
    "---",
    "",
  ].join("\n");

  return new Response(`${header}${sections.join("\n---\n\n")}`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Robots-Tag": "noindex",
    },
  });
}
