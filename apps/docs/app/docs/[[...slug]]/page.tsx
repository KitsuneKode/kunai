import { DocsStatusBadge } from "@/components/docs/docs-status-badge";
import { RelatedDocLinks } from "@/components/docs/related-doc-links";
import { navGroupForHref } from "@/lib/doc-page-nav";
import { docsEditUrl, docsGithubDiscussionsUrl } from "@/lib/docs-github";
import {
  breadcrumbListJsonLd,
  faqPageJsonLd,
  serializeJsonLd,
  techArticleJsonLd,
} from "@/lib/json-ld";
import { docsMarkdownPath } from "@/lib/llms";
import { buildPageMetadata, docsOgImagePath } from "@/lib/page-metadata";
import { docsCanonicalUrl } from "@/lib/site";
import { source } from "@/lib/source";
import { troubleshootingFaqEntries } from "@/lib/troubleshooting-faq";
import { useMDXComponents } from "@/mdx-components";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  EditOnGitHub,
  MarkdownCopyButton,
  PageLastUpdate,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
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

  return buildPageMetadata({
    title: page.data.title,
    description: page.data.description ?? "",
    path: page.url,
    type: "article",
    socialImageUrl: docsOgImagePath(page.url),
    markdownPath: docsMarkdownPath(page.url),
  });
}

function readLastModified(pageData: { readonly lastModified?: Date }): Date | undefined {
  const value = pageData.lastModified;
  return value instanceof Date ? value : undefined;
}

function breadcrumbItemsFor(page: {
  readonly url: string;
  readonly data: { readonly title: string };
}) {
  const home = { name: "Kunai", url: docsCanonicalUrl("/") };
  const root = { name: "Kunai Docs", url: docsCanonicalUrl("/docs") };
  if (page.url === "/docs") return [home, root];

  const section = page.url.startsWith("/docs/users/")
    ? { name: "User guides", url: docsCanonicalUrl("/docs/users") }
    : page.url.startsWith("/docs/developer/")
      ? { name: "Developer", url: docsCanonicalUrl("/docs/developer") }
      : null;

  return section
    ? [home, root, section, { name: page.data.title, url: docsCanonicalUrl(page.url) }]
    : [home, root, { name: page.data.title, url: docsCanonicalUrl(page.url) }];
}

export default async function Page({ params }: PageProps) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const components = useMDXComponents();
  const editUrl = docsEditUrl(page.path);
  const markdownUrl = docsMarkdownPath(page.url);
  const canonicalUrl = docsCanonicalUrl(page.url);
  const lastModified = readLastModified(page.data);
  const isIndexHub = page.path === "index.mdx" || page.path.endsWith("/index.mdx");
  const pageStatus = (page.data as { status?: string }).status;
  const navGroup = navGroupForHref(page.url);
  const articleJsonLd = techArticleJsonLd({
    title: page.data.title,
    description: page.data.description ?? "Kunai documentation",
    url: canonicalUrl,
    image: docsCanonicalUrl(docsOgImagePath(page.url)),
    dateModified: lastModified?.toISOString(),
  });
  const breadcrumbJsonLd = breadcrumbListJsonLd(breadcrumbItemsFor(page));
  const faqJsonLd =
    page.data.info.path === "users/troubleshooting.mdx"
      ? faqPageJsonLd(troubleshootingFaqEntries)
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      {faqJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      ) : null}
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
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <div className="not-prose mt-3 mb-6 flex flex-wrap items-center gap-2 border-b border-[var(--kunai-line)] pb-4">
          <DocsStatusBadge status={pageStatus} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <MarkdownCopyButton markdownUrl={markdownUrl} />
            <ViewOptionsPopover
              markdownUrl={markdownUrl}
              githubUrl={editUrl}
              pageUrl={canonicalUrl}
            />
          </div>
        </div>
        <DocsBody>
          <MDX components={components} />
        </DocsBody>
        {navGroup ? <RelatedDocLinks group={navGroup} currentHref={page.url} /> : null}
        <div className="not-prose border-fd-border mt-10 flex flex-col gap-4 rounded-2xl border bg-[#131311] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm font-medium text-[#f5f3ee]">
              Something unclear or a provider drifted?
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <Link href="/feedback" className="text-fd-primary underline-offset-4 hover:underline">
                Report an issue
              </Link>
              <a
                href={docsGithubDiscussionsUrl()}
                target="_blank"
                rel="noreferrer noopener"
                className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
              >
                Ask in Discussions
              </a>
              <Link
                href="/support"
                className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
              >
                Support Kunai
              </Link>
            </div>
          </div>
          <div className="border-fd-border flex flex-wrap items-center justify-between gap-4 border-t pt-4">
            <EditOnGitHub href={editUrl} />
            {lastModified ? <PageLastUpdate date={lastModified} /> : null}
          </div>
        </div>
      </DocsPage>
    </>
  );
}
