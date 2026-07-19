import { codeMetadata } from "@/lib/code-metadata";
import { readReleaseNotesArtifacts, releasePath } from "@/lib/release-notes";
import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export const dynamic = "force-static";

export async function GET() {
  const pages = source.getPages();
  const releases = readReleaseNotesArtifacts();
  const lines = [
    "# Kunai Docs",
    "",
    `@doc-version: ${codeMetadata.cliVersion}`,
    `@cli-source-revision: ${codeMetadata.cliSourceRevision}`,
    `@synced-at: ${codeMetadata.syncedAt}`,
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
    ...releases.map(
      (release) =>
        `- [${release.title}](${docsSiteUrl}${releasePath(release.tag)}): ${release.tag}`,
    ),
    `- [Feedback](${docsSiteUrl}/feedback): File bugs, provider issues, and feature requests on GitHub`,
    `- [Opt-in telemetry](${docsSiteUrl}/telemetry): Public opt-in usage pulse and consent rules`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
