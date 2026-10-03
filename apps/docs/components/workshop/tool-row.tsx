import { primaryUrl, type WorkshopMeta, type WorkshopProject } from "@/lib/workshop";
import { IconArrowUpRight } from "@tabler/icons-react";

import { ProjectFacts, ProjectPreview, SourceLink } from "./project-parts";

/**
 * A developer tool as a row. Tools are smaller than products and most have no
 * site to screenshot, so a row (a thumbnail slot, the name and what it does)
 * scans faster than a card with an empty picture. The thumbnail is the same
 * `ProjectPreview` as everywhere else: a screenshot where there is one, the
 * name set in type where there is not.
 */
export function ToolRow({
  project,
  meta,
}: {
  readonly project: WorkshopProject;
  readonly meta: WorkshopMeta | undefined;
}) {
  return (
    <article className="group/row has-[a:focus-visible]:ring-ring border-fd-border bg-fd-card/60 relative grid gap-4 rounded-xl border p-3 transition-[border-color] duration-200 ease-[var(--ease-out)] hover:border-[color-mix(in_oklab,var(--kunai-accent)_32%,transparent)] has-[a:focus-visible]:ring-2 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center">
      <div className="border-fd-border overflow-hidden rounded-lg border">
        <ProjectPreview project={project} />
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:py-1 sm:pr-2">
        <header className="flex items-baseline justify-between gap-3">
          <h3 className="m-0 min-w-0 text-base leading-snug font-medium">
            <a
              href={primaryUrl(project)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fd-foreground after:absolute after:inset-0 after:content-['']"
            >
              {project.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <span className="text-fd-muted-foreground ml-2 text-xs font-normal">
              {project.kind}
            </span>
          </h3>
          <IconArrowUpRight
            aria-hidden="true"
            className="text-fd-muted-foreground size-4 shrink-0 transition-transform duration-150 ease-[var(--ease-out)] group-hover/row:translate-x-0.5 group-hover/row:-translate-y-0.5"
            stroke={1.5}
          />
        </header>
        <p className="text-fd-muted-foreground m-0 text-sm leading-6 text-pretty">
          {project.summary}
        </p>
        <footer className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <ProjectFacts project={project} meta={meta} />
          <SourceLink project={project} />
        </footer>
      </div>
    </article>
  );
}
