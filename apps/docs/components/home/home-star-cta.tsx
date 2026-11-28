import { Odometer } from "@/components/home/odometer";
import { fetchGithubStarCount, githubStarUrl } from "@/lib/github-stars";
import { IconStar } from "@tabler/icons-react";

function HomeStarLink({ stars }: { readonly stars: number | null }) {
  return (
    <a
      className="kunai-button group border-[var(--home-hair-strong)] bg-[var(--home-raise-1)] hover:border-[var(--kunai-accent)]"
      href={githubStarUrl()}
      rel="noreferrer"
      target="_blank"
    >
      <IconStar
        className="hover-fine:group-hover:scale-110 mr-1.5 size-4 transition-transform duration-150 ease-[var(--ease-out)]"
        stroke={1.5}
      />
      <span>Star on GitHub</span>
      {stars === null ? null : (
        <span className="ml-2 rounded-md border border-[var(--home-hair-strong)] bg-[var(--home-well)] px-1.5 py-0.5 font-mono text-xs text-[var(--home-text-2)] tabular-nums">
          <Odometer value={stars} />
        </span>
      )}
    </a>
  );
}

export function HomeStarCtaFallback() {
  return <HomeStarLink stars={null} />;
}

/** Homepage GitHub star CTA, streaming the live star count when available. */
export async function HomeStarCta() {
  const stars = await fetchGithubStarCount();
  return <HomeStarLink stars={stars} />;
}
