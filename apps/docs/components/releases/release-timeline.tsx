import {
  githubReleaseTagUrl,
  releaseOneLineSummary,
  releasePath,
  type ReleaseNotesArtifact,
} from "@/lib/release-notes";
import Link from "next/link";

type ReleaseTimelineProps = {
  readonly releases: readonly ReleaseNotesArtifact[];
};

export function ReleaseTimeline({ releases }: ReleaseTimelineProps) {
  const latest = releases[0];
  if (!latest) {
    return <p className="text-fd-muted-foreground text-sm">No release artifacts are available.</p>;
  }

  const previous = releases.slice(1);

  return (
    <div className="grid gap-10">
      <article className="kunai-surface-shell p-1">
        <div className="kunai-surface-shell__inner border-fd-border rounded-[calc(var(--kunai-radius-outer)-0.15rem)] border p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="kunai-type-caption m-0">Latest</p>
              <p className="text-fd-muted-foreground mt-2 text-sm tabular-nums">{latest.tag}</p>
              <h2 className="kunai-type-title mt-1 text-2xl">
                <Link
                  href={releasePath(latest.tag)}
                  className="hover:text-fd-primary transition-colors"
                >
                  {latest.title}
                </Link>
              </h2>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                href={releasePath(latest.tag)}
                className="text-fd-primary font-medium underline-offset-4 hover:underline"
              >
                Full notes
              </Link>
              <a
                className="text-fd-muted-foreground font-medium underline-offset-4 hover:underline"
                href={githubReleaseTagUrl(latest.tag)}
              >
                GitHub
              </a>
            </div>
          </div>
          <p className="text-fd-muted-foreground mt-4 max-w-3xl text-sm leading-6">
            {releaseOneLineSummary(latest)}
          </p>
        </div>
      </article>

      {previous.length > 0 ? (
        <section aria-labelledby="previous-releases-heading">
          <h2 id="previous-releases-heading" className="kunai-type-title text-xl">
            Previous releases
          </h2>
          <ol className="border-fd-border relative mt-6 flex flex-col gap-0 border-l pl-6">
            {previous.map((release) => (
              <li key={release.tag} className="relative pb-8 last:pb-0">
                <span
                  className="bg-fd-primary absolute top-1.5 -left-[1.55rem] size-2.5 rounded-full"
                  aria-hidden
                />
                <div className="border-fd-border flex flex-col gap-2 rounded-md border p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-fd-muted-foreground text-xs tabular-nums">{release.tag}</p>
                    <Link
                      href={releasePath(release.tag)}
                      className="kunai-type-title text-base hover:underline"
                    >
                      {release.title}
                    </Link>
                    <p className="text-fd-muted-foreground mt-2 text-sm leading-6">
                      {releaseOneLineSummary(release)}
                    </p>
                  </div>
                  <Link
                    href={releasePath(release.tag)}
                    className="text-fd-primary shrink-0 text-sm font-medium underline-offset-4 hover:underline"
                  >
                    Notes
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
