import {
  githubReleaseUrl,
  releaseOneLineSummary,
  releasePath,
  type ReleaseNotesArtifact,
} from "@/lib/release-notes";
import Link from "next/link";

type ReleaseTimelineProps = {
  readonly releases: readonly ReleaseNotesArtifact[];
};

export function ReleaseTimeline({ releases }: ReleaseTimelineProps) {
  const published = releases.filter((release) => release.status === "published");
  const staged = releases.filter((release) => release.status === "staged");
  const latest = published[0];
  const previous = published.slice(1);
  const latestGithubUrl = latest ? githubReleaseUrl(latest) : null;

  if (!latest && staged.length === 0) {
    return <p className="text-fd-muted-foreground text-sm">No release artifacts are available.</p>;
  }

  return (
    <div className="grid gap-10">
      {staged.length > 0 ? (
        <section aria-labelledby="upcoming-releases-heading">
          <h2 id="upcoming-releases-heading" className="kunai-type-title text-xl">
            Upcoming
          </h2>
          <ol className="border-fd-border relative mt-6 flex flex-col gap-0 border-l pl-6">
            {staged.map((release) => (
              <li key={release.tag} className="relative pb-8 last:pb-0">
                <span
                  className="bg-fd-muted-foreground absolute top-1.5 -left-[1.55rem] size-2.5 rounded-full"
                  aria-hidden
                />
                <div className="border-fd-border flex flex-col gap-2 rounded-md border border-dashed p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-fd-muted-foreground text-xs tabular-nums">
                      {release.tag} · staged
                    </p>
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
                    Preview
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {latest ? (
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
                {latestGithubUrl ? (
                  <a
                    className="text-fd-muted-foreground font-medium underline-offset-4 hover:underline"
                    href={latestGithubUrl}
                  >
                    GitHub
                  </a>
                ) : null}
              </div>
            </div>
            <p className="text-fd-muted-foreground mt-4 max-w-3xl text-sm leading-6">
              {releaseOneLineSummary(latest)}
            </p>
          </div>
        </article>
      ) : null}

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
