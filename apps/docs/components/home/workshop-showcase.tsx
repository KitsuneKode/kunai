import { fetchWorkshopMeta } from "@/lib/github-repos";
import {
  presentWorkshopMeta,
  workshop,
  type WorkshopMeta,
  type WorkshopProject,
} from "@/lib/workshop";
import { IconArrowUpRight, IconBrandGithub, IconStar } from "@tabler/icons-react";

/**
 * "Also from the workshop": the maintainer's other original projects.
 *
 * Shown on the home page because someone who trusts one tool by a maintainer is
 * the person most likely to want the next one, and because a project with several
 * living siblings reads as maintained rather than abandoned. The footer carries
 * the same list in compressed form; both read `lib/workshop.ts`.
 *
 * A card is a preview, not a pitch: the project's own one-line description, the
 * facts a visitor uses to decide whether to click (language, last updated,
 * stars once there are enough to mean something) and the two places it lives.
 * Facts come from a cached GitHub lookup and degrade to the curated copy.
 */
export async function WorkshopShowcase() {
  const meta = await fetchWorkshopMeta();

  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {workshop.map((project) => (
        <li key={project.repo} className="flex">
          <ProjectCard project={project} meta={meta.get(project.repo)} />
        </li>
      ))}
    </ul>
  );
}

function monogram(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  const words = cleaned.split(" ");
  return (words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : cleaned.slice(0, 2))
    .toLowerCase()
    .padEnd(2, "·");
}

function formatUpdated(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ProjectCard({
  project,
  meta,
}: {
  readonly project: WorkshopProject;
  readonly meta: WorkshopMeta | undefined;
}) {
  const facts = presentWorkshopMeta(project, meta);
  const primaryUrl = project.siteUrl ?? project.repoUrl;

  return (
    <article className="kunai-surface-shell group/card has-[a:focus-visible]:ring-ring relative flex w-full flex-col transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)] hover:border-[color-mix(in_oklab,var(--kunai-accent)_32%,transparent)] has-[a:focus-visible]:ring-2">
      <div className="kunai-surface-shell__inner flex h-full flex-col gap-4 p-5">
        <header className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="text-fd-primary flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--kunai-accent)_12%,var(--kunai-surface))] font-mono text-sm font-medium"
          >
            {monogram(project.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base leading-snug font-medium">
              {/* The stretched link: the whole card is the target for the project's
                  main page, while the repository link below sits above it. */}
              <a
                href={primaryUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-fd-foreground after:absolute after:inset-0 after:content-['']"
              >
                {project.name}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </h3>
            <p className="text-fd-muted-foreground m-0 mt-0.5 text-xs">{project.kind}</p>
          </div>
          <IconArrowUpRight
            aria-hidden="true"
            className="text-fd-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-[var(--ease-out)] group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5"
            stroke={1.5}
          />
        </header>

        <p className="text-fd-muted-foreground m-0 text-sm leading-6 text-pretty">
          {project.tagline}
        </p>

        <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs">
          <span className="text-fd-foreground font-mono">{facts.language}</span>
          {facts.stars !== null ? (
            <span className="text-fd-muted-foreground inline-flex items-center gap-1 tabular-nums">
              <IconStar className="size-3.5" stroke={1.5} aria-hidden="true" />
              {facts.stars}
              <span className="sr-only"> stars</span>
            </span>
          ) : null}
          {facts.updated ? (
            <span className="text-fd-muted-foreground tabular-nums">
              Updated {formatUpdated(facts.updated)}
            </span>
          ) : null}
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-fd-muted-foreground hover:text-fd-foreground relative z-10 ml-auto inline-flex items-center gap-1 rounded-md px-1 py-1 transition-colors duration-150"
          >
            <IconBrandGithub className="size-3.5" stroke={1.5} aria-hidden="true" />
            Source
            <span className="sr-only">: {project.name} on GitHub (opens in a new tab)</span>
          </a>
        </footer>
      </div>
    </article>
  );
}
