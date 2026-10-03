import { ContactSection } from "@/components/workshop/contact-section";
import { ToolRow } from "@/components/workshop/tool-row";
import { WorkshopCard } from "@/components/workshop/workshop-card";
import { fetchWorkshopMeta } from "@/lib/github-repos";
import { buildPageMetadata } from "@/lib/page-metadata";
import { projectsIn } from "@/lib/workshop";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = buildPageMetadata({
  title: "More from KitsuneKode: the other projects behind Kunai",
  absoluteTitle: true,
  description:
    "Other things KitsuneKode builds: Kitsu Lab, Kyma, JS Questions Lab, sweep, kittymux, YT Dedupe and Caffeine Mode. Originals only, with links to each project and its source.",
  socialDescription:
    "The other projects behind Kunai: web apps, a component playground and developer tools. Originals only.",
  path: "/workshop",
});

export default async function WorkshopPage() {
  // Cached for an hour and tolerant of failure: a rate-limited lookup leaves the cards
  // without stars or a date, never without the page.
  const meta = await fetchWorkshopMeta();
  const products = projectsIn("products");
  const tools = projectsIn("tools");

  return (
    <main className="kunai-home relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-14 px-6 py-14 md:px-10">
      <header className="border-border flex flex-col gap-4 border-b pb-10">
        <p className="text-muted-foreground m-0 text-xs font-medium tracking-[0.16em] uppercase">
          The workshop
        </p>
        <h1 className="kunai-display-title max-w-none text-4xl md:text-5xl">
          More from KitsuneKode
        </h1>
        <p className="text-muted-foreground max-w-2xl text-base leading-7 text-pretty">
          Kunai is one of several projects from the same workshop. These are the others the
          maintainer stands behind: original work, not forks, each with a live site or a repository
          you can read.
        </p>
      </header>

      <section aria-labelledby="products" className="flex flex-col gap-6">
        <h2 id="products" className="kunai-type-title text-2xl">
          Products and playgrounds
        </h2>
        <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((project) => (
            <li key={project.repo} className="flex">
              <WorkshopCard project={project} meta={meta.get(project.repo)} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tools" className="flex flex-col gap-6">
        <h2 id="tools" className="kunai-type-title text-2xl">
          Developer tools
        </h2>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {tools.map((project) => (
            <li key={project.repo}>
              <ToolRow project={project} meta={meta.get(project.repo)} />
            </li>
          ))}
        </ul>
      </section>

      <ContactSection />
    </main>
  );
}
