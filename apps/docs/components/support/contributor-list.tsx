import type { Contributor } from "@/lib/contributors";
import { fetchContributors } from "@/lib/github-repos";

/**
 * Outside contributors, by name.
 *
 * Text and links, with no avatars: an avatar is an image request to a host that is
 * not ours for every visitor, which the rest of this site does not do. Shown only
 * when there is someone to show. A wall of placeholders would claim a community
 * that does not exist yet, so with no contributors the callers render nothing here.
 */
export function ContributorList({
  contributors,
}: {
  readonly contributors: readonly Contributor[];
}) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {contributors.map((contributor) => (
        <li key={contributor.login}>
          <a
            href={contributor.url}
            target="_blank"
            rel="noreferrer noopener"
            className="border-border bg-card hover:border-primary inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-[border-color] duration-150"
          >
            @{contributor.login}
            <span className="text-muted-foreground text-xs tabular-nums">
              {contributor.contributions} {contributor.contributions === 1 ? "change" : "changes"}
            </span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** How many names the home page's one-line credit prints before it says "and N more". */
const CREDIT_LIMIT = 6;

/**
 * "With help from @a, @b and 2 more", for the home page. Renders nothing when
 * there are no contributors, which is the state today.
 */
export async function ContributorCredit() {
  const contributors = await fetchContributors();
  if (contributors.length === 0) return null;
  const shown = contributors.slice(0, CREDIT_LIMIT);
  const rest = contributors.length - shown.length;
  return (
    <p className="text-fd-muted-foreground m-0 max-w-prose text-sm leading-6 text-pretty">
      With help from{" "}
      {shown.map((contributor, index) => (
        <span key={contributor.login}>
          {index > 0 ? ", " : ""}
          <a
            href={contributor.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fd-foreground underline underline-offset-4"
          >
            @{contributor.login}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </span>
      ))}
      {rest > 0 ? ` and ${rest} more` : ""}.
    </p>
  );
}
