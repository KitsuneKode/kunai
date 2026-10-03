import { presentWorkshopMeta, type WorkshopMeta, type WorkshopProject } from "@/lib/workshop";
import { IconBrandGithub, IconStar } from "@tabler/icons-react";

/**
 * The small pieces every project surface shares: the preview (a screenshot, or a
 * typographic tile where there is no site), and the facts line. The home page
 * cards and the `/workshop` page both compose these, so a fact is never
 * formatted two ways.
 */

export function formatUpdated(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The preview slot.
 *
 * A project with a site gets a real screenshot of it, bundled with the docs so a
 * visitor makes no request to another host for it. A project with no site gets a
 * tile that says its name, not a made-up picture of software that has none. The
 * box is the same either way, so a row of cards never has ragged tops.
 */
export function ProjectPreview({
  project,
  className = "",
}: {
  readonly project: WorkshopProject;
  readonly className?: string;
}) {
  if (project.preview) {
    return (
      <img
        src={project.preview}
        width={1200}
        height={750}
        alt={`The ${project.name} home page`}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={`aspect-[16/10] w-full object-cover object-top ${className}`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`border-fd-border relative flex aspect-[16/10] w-full items-end overflow-hidden bg-[radial-gradient(circle_at_18%_12%,var(--kunai-accent-glow),transparent_60%),var(--kunai-surface-strong)] p-4 ${className}`}
    >
      <span className="text-fd-foreground font-mono text-lg leading-tight font-medium tracking-tight text-balance">
        {project.name}
      </span>
    </div>
  );
}

export function ProjectFacts({
  project,
  meta,
}: {
  readonly project: WorkshopProject;
  readonly meta: WorkshopMeta | undefined;
}) {
  const facts = presentWorkshopMeta(project, meta);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
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
    </div>
  );
}

/** The "Source" link, raised above a card's stretched link so both stay clickable. */
export function SourceLink({ project }: { readonly project: WorkshopProject }) {
  return (
    <a
      href={project.repoUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="text-fd-muted-foreground hover:text-fd-foreground relative z-10 inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs transition-colors duration-150"
    >
      <IconBrandGithub className="size-3.5" stroke={1.5} aria-hidden="true" />
      Source
      <span className="sr-only">: {project.name} on GitHub (opens in a new tab)</span>
    </a>
  );
}
