import { source } from "@/lib/source";
import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: page.slugs }));
}

/**
 * Per-page Markdown for agents: `/llms.mdx/users/getting-started` answers the
 * same page `/docs/users/getting-started` renders as HTML. Generated from the
 * same compiled MDX, so the two can never drift.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = source.getPage(slug ?? []);
  if (!page) notFound();

  return new Response(await page.data.getText("processed"), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
