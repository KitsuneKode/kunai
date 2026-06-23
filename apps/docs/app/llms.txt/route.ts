import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET() {
  const pages = source.getPages();
  const lines = [
    "# Kunai Docs",
    "",
    "> Terminal-first guides for Kunai playback, recovery, offline use, and diagnostics.",
    "",
    `Site: ${docsSiteUrl}`,
    "",
    "## Pages",
    "",
    ...pages.map(
      (page) => `- [${page.data.title}](${docsSiteUrl}${page.url}): ${page.data.description}`,
    ),
    "",
    `- [Release notes](${docsSiteUrl}/releases): Changelog generated from release artifacts`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
