import { WorkshopCard } from "@/components/workshop/workshop-card";
import { fetchWorkshopMeta } from "@/lib/github-repos";
import { primaryUrl, projectsIn } from "@/lib/workshop";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";

/**
 * "More from the same workshop": the maintainer's other original projects.
 *
 * Shown on the home page because someone who trusts one tool by a maintainer is
 * the person most likely to want the next one, and because a project with several
 * living siblings reads as maintained rather than abandoned.
 *
 * It is a pointer, not the catalogue. The products get a preview card each, the
 * developer tools are a line of names, and the full descriptions, the screenshots
 * and the contact section live on `/workshop`. The footer carries the names too;
 * all three read `lib/workshop.ts`. Facts come from a cached GitHub lookup and
 * degrade to the curated copy.
 */
export async function WorkshopShowcase() {
  const meta = await fetchWorkshopMeta();
  const products = projectsIn("products");
  const tools = projectsIn("tools");

  return (
    <div className="flex flex-col gap-6">
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((project) => (
          <li key={project.repo} className="flex">
            <WorkshopCard project={project} meta={meta.get(project.repo)} compact />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="text-fd-muted-foreground text-sm">And the tools:</span>
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {tools.map((project) => (
            <li key={project.repo}>
              <a
                href={primaryUrl(project)}
                target="_blank"
                rel="noreferrer noopener"
                className="border-fd-border text-fd-foreground hover:border-fd-primary inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors duration-150"
              >
                {project.name}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
        <Link
          href="/workshop"
          className="text-fd-primary hover:text-fd-foreground ml-auto inline-flex items-center gap-1.5 text-sm transition-colors duration-150"
        >
          See everything
          <IconArrowRight className="size-4" stroke={1.5} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
