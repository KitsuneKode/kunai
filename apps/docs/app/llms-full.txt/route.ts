import { codeMetadata } from "@/lib/code-metadata";
import { docsSiteUrl } from "@/lib/site";
import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const dynamic = "force-static";

export async function GET() {
  const docs = llms(source, {
    renderPage: (page) => page.data.getText("processed"),
  });

  const header = [
    "# Kunai Docs (full)",
    "",
    `@doc-version: ${codeMetadata.cliVersion}`,
    "",
    "> Every documentation page as one Markdown document, for agents and readers",
    "> that want the whole corpus in a single fetch. Index: /llms.txt",
    "",
    `Site: ${docsSiteUrl}`,
    "",
  ];

  const body = await docs.full();
  return new Response(header.join("\n") + body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
