import { formatDocPageMarkdown } from "@/lib/llms";
import { source } from "@/lib/source";
import { notFound } from "next/navigation";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams();
}

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly slug?: string[] }> },
) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  return new Response(await formatDocPageMarkdown(page), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
