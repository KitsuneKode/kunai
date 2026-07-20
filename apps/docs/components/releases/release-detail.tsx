import { ReleaseInstallPanel } from "@/components/releases/release-install-panel";
import { ReleaseSectionList, SummaryBlocks } from "@/components/releases/release-sections";
import {
  displaySectionsForRelease,
  githubReleaseUrl,
  releaseAssetsForDisplay,
  type ReleaseNotesArtifact,
} from "@/lib/release-notes";
import Link from "next/link";

type ReleaseDetailProps = {
  readonly release: ReleaseNotesArtifact;
};

export function ReleaseDetail({ release }: ReleaseDetailProps) {
  const sections = displaySectionsForRelease(release);
  const assets = releaseAssetsForDisplay(release);
  const githubUrl = githubReleaseUrl(release);
  const isStaged = release.status === "staged";

  return (
    <article className="flex flex-col gap-10">
      <header className="border-fd-border flex flex-col gap-4 border-b pb-8">
        <p className="kunai-type-caption m-0">
          <Link href="/releases" className="hover:underline">
            Releases
          </Link>
          <span className="text-fd-muted-foreground"> / </span>
          <span className="tabular-nums">{release.tag}</span>
          {isStaged ? (
            <span className="text-fd-muted-foreground"> · staged (not published)</span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">{release.title}</h1>
            {release.date ? (
              <p className="text-fd-muted-foreground mt-2 text-sm tabular-nums">{release.date}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {githubUrl ? (
              <a
                className="text-fd-primary font-medium underline-offset-4 hover:underline"
                href={githubUrl}
              >
                GitHub release
              </a>
            ) : null}
            <Link
              href="/feedback"
              className="text-fd-muted-foreground font-medium underline-offset-4 hover:underline"
            >
              Feedback
            </Link>
          </div>
        </div>
        <SummaryBlocks summary={release.summary} />
      </header>

      <ReleaseInstallPanel release={release} showCanonical />

      <ReleaseSectionList sections={sections} />

      {assets.length > 0 ? (
        <section
          className="border-fd-border rounded-lg border p-6"
          aria-labelledby="assets-heading"
        >
          <h2 id="assets-heading" className="kunai-type-title text-xl">
            Release assets
          </h2>
          <ul className="mt-4 grid gap-2 font-mono text-xs">
            {assets.map((asset) => (
              <li
                key={asset.name}
                className="border-fd-border flex flex-col gap-1 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>{asset.name}</span>
                <span className="text-fd-muted-foreground break-all">{asset.sha256}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
