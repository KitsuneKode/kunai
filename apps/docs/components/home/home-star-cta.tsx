import { fetchGithubStarCount, formatStarCount, githubStarUrl } from "@/lib/github-stars";
import { IconStar } from "@tabler/icons-react";

/**
 * Homepage "support the project" CTA. Reuses the shared `kunai-button` shape so
 * it sits in the CTA row as a peer, and degrades to a plain star link when the
 * GitHub count is unavailable.
 */
export async function HomeStarCta() {
  const stars = await fetchGithubStarCount();

  return (
    <a
      className="kunai-button border-fd-border hover:border-fd-primary group"
      href={githubStarUrl()}
      rel="noreferrer"
      target="_blank"
    >
      <IconStar
        className="mr-1.5 size-4 transition-transform duration-150 ease-[var(--ease-out)] group-hover:scale-110"
        stroke={1.5}
      />
      <span>Star on GitHub</span>
      {stars === null ? null : (
        <span className="border-fd-border text-fd-muted-foreground ml-2 rounded-md border px-1.5 py-0.5 text-xs tabular-nums">
          {formatStarCount(stars)}
        </span>
      )}
    </a>
  );
}
