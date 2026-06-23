import { docsEditUrl } from "@/lib/docs-github";
import { techArticleJsonLd } from "@/lib/json-ld";
import { docsCanonicalUrl } from "@/lib/site";
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

export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: docsCanonicalUrl(page.url),
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: docsCanonicalUrl(page.url),
      type: "article",
      siteName: "Kunai Docs",
    },
    twitter: {
      card: "summary",
      title: page.data.title,
      description: page.data.description,
    },
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
  const isIndexHub = page.path === "index.mdx" || page.path.endsWith("/index.mdx");
  const articleJsonLd = techArticleJsonLd({
    title: page.data.title,
    description: page.data.description ?? "Kunai documentation",
    url: docsCanonicalUrl(page.url),
    ...(lastModified ? { dateModified: lastModified.toISOString() } : {}),
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <DocsPage
        className={isIndexHub ? "kunai-docs-index" : undefined}
        toc={page.data.toc}
        tableOfContent={{
          style: "clerk",
        }}
        tableOfContentPopover={{
          style: "clerk",
        }}
      >
        <div className="not-prose -mt-2 mb-2 flex justify-end">
          <ViewOptionsPopover githubUrl={editUrl} />
        </div>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={components} />
        </DocsBody>
        <div className="not-prose border-fd-border mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <EditOnGitHub href={editUrl} />
          {lastModified ? <PageLastUpdate date={lastModified} /> : null}
        </div>
      </DocsPage>
    </>
  );
}
