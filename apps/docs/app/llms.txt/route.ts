import { codeMetadata } from "@/lib/code-metadata";
import { BUN_GLOBAL_INSTALL, NATIVE_INSTALL_PS1, NATIVE_INSTALL_SH } from "@/lib/install-commands";
import { docsMarkdownPath } from "@/lib/llms";
import { provenance } from "@/lib/provenance";
import {
  latestReleaseNotesArtifact,
  publishedReleaseNotesArtifacts,
  releasePath,
} from "@/lib/release-notes";
import { docsCanonicalUrl, docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET() {
  const pages = [...source.getPages()].sort((a, b) => a.url.localeCompare(b.url));
  const releases = publishedReleaseNotesArtifacts();
  const latestPublished = latestReleaseNotesArtifact();

  const overviewPages = pages.filter((page) => page.url === "/docs");
  const userPages = pages.filter((page) => page.url.startsWith("/docs/users"));
  const developerPages = pages.filter((page) => page.url.startsWith("/docs/developer"));

  const formatDocLink = (page: (typeof pages)[number]) =>
    `- [${page.data.title}](${docsSiteUrl}${docsMarkdownPath(page.url)}): ${page.data.description ?? page.data.title}`;

  const lines = [
    "# Kunai Docs",
    "",
    `@doc-version: ${codeMetadata.cliVersion}`,
    ...(latestPublished ? [`@latest-published-version: ${latestPublished.version}`] : []),
    `@cli-source-revision: ${provenance.cliSourceRevision}`,
    `@synced-at: ${provenance.syncedAt}`,
    "",
    "> Kunai is a free, MIT-licensed, local-first terminal media client (TUI + CLI) for anime, movies, TV series, and YouTube, with supervised mpv playback, automatic multi-provider failover, multi-language audio and subtitles, SQLite resume history, and offline downloads.",
    "",
    `Site: ${docsCanonicalUrl("/")}`,
    `Full corpus: ${docsSiteUrl}/llms-full.txt`,
    "Markdown tip: append `.mdx` to any `/docs/...` URL to fetch its clean Markdown source.",
    "",
    "## Quick facts & install",
    "",
    `- Platforms: Linux, macOS, Windows, and Android Termux (external VLC / mpv-android handoff)`,
    `- Runtime requirement: mpv for desktop playback; optional yt-dlp for YouTube and downloads`,
    `- Install (Linux / macOS): \`${NATIVE_INSTALL_SH}\``,
    `- Install (Windows PowerShell): \`${NATIVE_INSTALL_PS1}\``,
    `- Install (Bun): \`${BUN_GLOBAL_INSTALL}\``,
    `- Privacy: local-first SQLite storage; zero accounts; analytics opt-in only`,
    `- Providers registered: ${codeMetadata.providers.length} (${codeMetadata.providers.map((p) => p.id).join(", ")})`,
    "",
    "## Complete documentation",
    "",
    `- [Full documentation (single file)](${docsSiteUrl}/llms-full.txt): All Kunai user and developer documentation concatenated as Markdown`,
    `- [Kunai home](${docsCanonicalUrl("/")}): Search anime, movies, TV series and YouTube; play in mpv and manage sources, subtitles, resume and offline downloads`,
    ...overviewPages.map(formatDocLink),
    "",
    "## User guides",
    "",
    ...userPages.map(formatDocLink),
    "",
    "## Developer guides",
    "",
    ...developerPages.map(formatDocLink),
    "",
    "## Releases",
    "",
    `- [Release notes](${docsSiteUrl}/releases): Changelog generated from release artifacts`,
    `- [Releases RSS feed](${docsSiteUrl}/releases/rss.xml): RSS 2.0 feed of published Kunai releases`,
    `- [Site RSS feed](${docsSiteUrl}/rss.xml): RSS 2.0 feed of releases and updated documentation`,
    `- [Site Atom feed](${docsSiteUrl}/atom.xml): Atom 1.0 feed of releases and updated documentation`,
    ...releases.map(
      (release) =>
        `- [${release.title}](${docsSiteUrl}${releasePath(release.tag)}): ${release.tag}`,
    ),
    "",
    "## Policies",
    "",
    `- [Privacy](${docsSiteUrl}/privacy): What leaves your machine, site telemetry, and third parties`,
    `- [Support Kunai](${docsSiteUrl}/support): Ways to support development and report problems`,
    "",
    "## Optional",
    "",
    `- [Feedback](${docsSiteUrl}/feedback): File bugs, provider issues, and feature requests on GitHub`,
    `- [Usage analytics](${docsSiteUrl}/analytics): Public usage pulse and opt-in rules`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
