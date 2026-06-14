import { docsEditUrl } from "@/lib/docs-github";
import { source } from "@/lib/source";
import { useMDXComponents } from "@/mdx-components";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
  PageLastUpdate,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PageProps = {
  readonly params: Promise<{ readonly slug?: string[] }>;
};

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}

function readLastModified(pageData: { readonly lastModified?: Date }): Date | undefined {
  const value = pageData.lastModified;
  return value instanceof Date ? value : undefined;
}

export default async function Page({ params }: PageProps) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const components = useMDXComponents();
  const editUrl = docsEditUrl(page.path);
  const lastModified = readLastModified(page.data);
  const isHub = Boolean(page.data.full);

  return (
    <div className={isHub ? "kunai-docs-hub" : undefined}>
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        breadcrumb={{ enabled: !isHub }}
        footer={{ enabled: true }}
        tableOfContent={{
          style: "clerk",
          enabled: !isHub,
        }}
        tableOfContentPopover={{
          enabled: !isHub,
        }}
      >
        {!isHub ? (
          <div className="kunai-docs-toolbar not-prose mb-6 flex flex-wrap items-center justify-end gap-3 px-3 py-2.5">
            <ViewOptionsPopover githubUrl={editUrl} />
          </div>
        ) : null}
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={components} />
        </DocsBody>
        <div className="not-prose border-fd-border mt-8 flex flex-row flex-wrap items-center justify-between gap-4 border-t pt-6">
          <EditOnGitHub href={editUrl} />
          {lastModified ? <PageLastUpdate date={lastModified} /> : null}
        </div>
      </DocsPage>
    </div>
  );
}
