import { fetchWorkshopMeta } from "@/lib/github-repos";
import {
  presentWorkshopMeta,
  workshop,
  type WorkshopMeta,
  type WorkshopProject,
} from "@/lib/workshop";
import { IconArrowUpRight, IconBrandGithub, IconStar } from "@tabler/icons-react";

import { WorkshopPreview } from "./workshop-preview";

function WorkshopGrid({ meta }: { readonly meta: ReadonlyMap<string, WorkshopMeta> }) {
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

const EMPTY_WORKSHOP_META: ReadonlyMap<string, WorkshopMeta> = new Map();

export function WorkshopShowcaseFallback() {
  return <WorkshopGrid meta={EMPTY_WORKSHOP_META} />;
}

/** Curated showcase of sibling KitsuneKode projects with cached GitHub metadata. */
export async function WorkshopShowcase() {
  const meta = await fetchWorkshopMeta();
  return <WorkshopGrid meta={meta} />;
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
  const currentYear = new Date().getUTCFullYear();
  const pushYear = date.getUTCFullYear();
  if (pushYear !== currentYear) {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
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

  const primaryHost = (() => {
    try {
      return new URL(primaryUrl).hostname;
    } catch {
      return project.repo;
    }
  })();

  return (
    <article className="kunai-workshop-card kunai-spotlight group/card has-[a:focus-visible]:ring-ring relative flex w-full flex-col has-[a:focus-visible]:ring-2">
      <div className="flex h-full flex-col gap-4 p-5">
        <div className="kunai-workshop-stage__frame">
          <WorkshopPreview project={project} />
          <span className="kunai-workshop-stage__host" aria-hidden="true">
            {primaryHost}
          </span>
        </div>
        <header className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--home-hair)] bg-[var(--home-raise-2)] font-mono text-xs font-medium text-[var(--home-text-2)]"
          >
            {monogram(project.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-[0.9375rem] leading-snug font-medium">
              {/* The stretched link: the whole card is the target for the project's
                  main page, while the repository link below sits above it. */}
              <a
                href={primaryUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[var(--home-text-1)] after:absolute after:inset-0 after:content-['']"
              >
                {project.name}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </h3>
            <p className="m-0 mt-0.5 text-xs text-[var(--home-text-4)]">{project.kind}</p>
          </div>
          <IconArrowUpRight
            aria-hidden="true"
            className="hover-fine:group-hover/card:translate-x-0.5 hover-fine:group-hover/card:-translate-y-0.5 size-4 shrink-0 text-[var(--home-text-4)] transition-transform duration-180 ease-[var(--ease-out)]"
            stroke={1.5}
          />
        </header>

        <p className="m-0 line-clamp-3 text-sm leading-6 text-pretty text-[var(--home-text-3)]">
          {project.tagline}
        </p>

        <footer className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--home-hair)] pt-3 text-xs">
          <span className="font-mono text-[var(--home-text-2)]">{facts.language}</span>
          {facts.stars !== null ? (
            <span className="inline-flex items-center gap-1 text-[var(--home-text-4)] tabular-nums">
              <IconStar className="size-3.5" stroke={1.5} aria-hidden="true" />
              {new Intl.NumberFormat("en-US").format(facts.stars)}
              <span className="sr-only"> stars</span>
            </span>
          ) : null}
          {facts.updated ? (
            <span className="text-[var(--home-text-4)] tabular-nums">
              Updated {formatUpdated(facts.updated)}
            </span>
          ) : null}
          <a
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="relative z-10 ml-auto inline-flex items-center gap-1 rounded-md px-1 py-1 text-[var(--home-text-4)] transition-colors duration-150 hover:text-[var(--home-text-1)]"
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
