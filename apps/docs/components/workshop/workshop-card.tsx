import { primaryUrl, type WorkshopMeta, type WorkshopProject } from "@/lib/workshop";
import { IconArrowUpRight } from "@tabler/icons-react";

import { ProjectFacts, ProjectPreview, SourceLink } from "./project-parts";

/**
 * A project as a preview card: its picture, name, what it is, and where to go.
 *
 * Used for the products on the home page and on `/workshop`. The whole card is
 * one link to the project's main page (a stretched link on the name), and the
 * source link sits above it, so the card is a large target without nesting one
 * link inside another.
 *
 * `compact` drops the longer summary for the home page, where the card is a
 * pointer to the full page, not the page itself.
 */
export function WorkshopCard({
  project,
  meta,
  compact = false,
}: {
  readonly project: WorkshopProject;
  readonly meta: WorkshopMeta | undefined;
  readonly compact?: boolean;
}) {
  return (
    <article className="kunai-surface-shell group/card has-[a:focus-visible]:ring-ring relative flex w-full flex-col transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)] hover:border-[color-mix(in_oklab,var(--kunai-accent)_32%,transparent)] has-[a:focus-visible]:ring-2">
      <div className="kunai-surface-shell__inner flex h-full flex-col overflow-hidden">
        <ProjectPreview project={project} className="border-fd-border border-b" />
        <div className="flex flex-1 flex-col gap-3 p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="m-0 text-base leading-snug font-medium">
                <a
                  href={primaryUrl(project)}
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
            {compact ? project.tagline : project.summary}
          </p>
          <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
            <ProjectFacts project={project} meta={meta} />
            <SourceLink project={project} />
          </footer>
        </div>
      </div>
    </article>
  );
}
