import { latestReleaseNotesArtifact, type ReleaseNotesArtifact } from "@/lib/release-notes";
import Link from "next/link";

type ReleaseWithdrawnNoticeProps = {
  readonly release: ReleaseNotesArtifact;
};

/**
 * The visible half of a withdrawal.
 *
 * Step 4 of the withdraw runbook (`.docs/release-reliability-gate.md`) names the
 * docs site as one of the three surfaces a withdrawal has to reach, on the
 * grounds that "a withdrawn version that is withdrawn silently gets reinstalled
 * from a cached tarball, a pinned CI file, or a blog post". Someone arriving
 * here is arriving from exactly one of those, so this has to say *what to do*,
 * not merely that something is wrong: upgrade if they are not on it, roll back
 * if they are.
 *
 * It replaces the install panel rather than sitting beside it — a page that
 * warns you off a version while still offering a copy button for it is worse
 * than one that does neither.
 */
export function ReleaseWithdrawnNotice({ release }: ReleaseWithdrawnNoticeProps) {
  const latest = latestReleaseNotesArtifact();
  const isLatest = latest?.tag === release.tag;

  return (
    <aside
      role="note"
      aria-labelledby="withdrawn-heading"
      className="border-fd-border bg-fd-muted/40 flex flex-col gap-3 rounded-md border border-dashed p-4 text-sm"
    >
      <p id="withdrawn-heading" className="kunai-type-caption m-0">
        Withdrawn — do not install {release.tag}
      </p>
      <p className="text-fd-muted-foreground m-0 leading-6">
        This release was pulled after publication. It is kept here so links to it still explain
        themselves, but it is no longer a supported version.
      </p>
      <ul className="text-fd-muted-foreground m-0 flex list-disc flex-col gap-1 pl-5 leading-6">
        <li>
          Already on {release.tag}? Run <code className="font-mono text-xs">kunai rollback</code> to
          restore the previously installed version.
        </li>
        <li>
          {latest && !isLatest ? (
            <>
              Otherwise install{" "}
              <Link
                href={`/releases/${latest.tag}`}
                className="text-fd-primary underline-offset-4 hover:underline"
              >
                {latest.tag}
              </Link>
              , the current release.
            </>
          ) : (
            <>
              Otherwise see{" "}
              <Link href="/releases" className="text-fd-primary underline-offset-4 hover:underline">
                all releases
              </Link>{" "}
              for the current version.
            </>
          )}
        </li>
      </ul>
    </aside>
  );
}
