import { fetchGithubStarCount, formatStarCount, githubStarUrl } from "@/lib/github-stars";
import { IconBrandGithub, IconStar } from "@tabler/icons-react";

/**
 * Sidebar footer CTA: star the repo, with the live count when GitHub answers.
 *
 * The count is decoration — `fetchGithubStarCount` returns `null` on a rate
 * limited or failed build, and the CTA still renders as a plain link. It must
 * never be the reason a page fails to build.
 */
export async function GithubStarCta() {
  const stars = await fetchGithubStarCount();

  return (
    <a
      href={githubStarUrl()}
      rel="noreferrer"
      target="_blank"
      // Outer radius 10px = inner badge radius 6px + 4px padding (concentric).
      className="group bg-fd-card/40 hover:bg-fd-card hover:border-fd-primary/40 flex min-h-10 items-center gap-2 rounded-[10px] border border-[var(--kunai-line)] p-1 pl-2.5 transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
    >
      <IconBrandGithub
        className="text-fd-muted-foreground group-hover:text-fd-foreground size-4 shrink-0 transition-colors duration-150"
        stroke={1.5}
      />
      <span className="text-fd-foreground text-xs font-medium">Star on GitHub</span>

      {stars === null ? null : (
        <span className="bg-fd-background text-fd-muted-foreground group-hover:text-fd-foreground ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--kunai-line)] px-1.5 py-0.5 text-xs tabular-nums transition-colors duration-150">
          <IconStar className="size-3 shrink-0" stroke={2} />
          {formatStarCount(stars)}
        </span>
      )}
    </a>
  );
}
