import { describe, expect, test } from "bun:test";

import { GET as getLlmsFull } from "../app/llms-full.txt/route";
import { GET as getLlmsMdx } from "../app/llms.mdx/[[...slug]]/route";
import { GET as getLlmsIndex } from "../app/llms.txt/route";
import { docsMarkdownPath } from "../lib/llms";
import { docsSiteUrl } from "../lib/site";

describe("LLM-friendly documentation routes", () => {
  test("docsMarkdownPath maps root and nested docs URLs to .mdx paths", () => {
    expect(docsMarkdownPath("/docs")).toBe("/docs.mdx");
    expect(docsMarkdownPath("/docs/users/getting-started")).toBe("/docs/users/getting-started.mdx");
  });

  test("llms.txt references llms-full.txt and .mdx endpoints", async () => {
    const response = await getLlmsIndex();
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain(`${docsSiteUrl}/llms-full.txt`);
    expect(text).toContain(`${docsSiteUrl}/docs/users/getting-started.mdx`);
    expect(text).toContain("## User guides");
    expect(text).toContain("## Developer guides");
  });

  test("llms.mdx serves Markdown for root and nested docs pages (raw fallback under bun test; next build exercises processed)", async () => {
    const rootRes = await getLlmsMdx(new Request(`${docsSiteUrl}/llms.mdx`), {
      params: Promise.resolve({ slug: undefined }),
    });
    expect(rootRes.headers.get("Content-Type")).toContain("text/markdown");
    const rootMd = await rootRes.text();
    expect(rootMd).toContain("# Kunai Documentation");
    expect(rootMd).toContain(`URL: ${docsSiteUrl}/docs`);

    const nestedRes = await getLlmsMdx(
      new Request(`${docsSiteUrl}/llms.mdx/users/getting-started`),
      {
        params: Promise.resolve({ slug: ["users", "getting-started"] }),
      },
    );
    expect(nestedRes.headers.get("Content-Type")).toContain("text/markdown");
    const nestedMd = await nestedRes.text();
    expect(nestedMd).toContain("# Getting Started");
    expect(nestedMd).toContain("kunai --setup");
  });

  test("llms-full.txt serves the complete concatenated documentation corpus", async () => {
    const response = await getLlmsFull();
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("# Kunai Complete Documentation");
    expect(text).toContain("@doc-version:");
    expect(text).toContain("# Getting Started");
    expect(text).toContain("# Troubleshooting");
    expect(text).toContain("# Contribute");
    expect(text).not.toContain("<ProviderTable");
    expect(text).not.toContain("<CliFlagsTable");
    expect(text).toContain("| ID | Provider | Media kinds |");
  });
});
